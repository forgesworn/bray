/**
 * The bunker daemon's connect secret: a new client must connect with the
 * one-time secret from the current link; clients approved earlier reconnect
 * without it; --open and --authorized-keys keep their own rules.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext } from '../src/bunker-context.js'
import { writeStateFile } from '../src/state.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const PORT = 19653

let relay: ReturnType<typeof startRelay>
let ctx: IdentityContext
let bunker: ReturnType<typeof startBunker>
const bunkerKeyHex = Buffer.from(generateSecretKey()).toString('hex')
const daemonDir = mkdtempSync(join(tmpdir(), 'bray-secret-daemon-'))
const linkChanges: string[] = []

const clientDir = () => mkdtempSync(join(tmpdir(), 'bray-secret-client-'))
const secretOf = (uri: string) => new URL(uri).searchParams.get('secret')
const withoutSecret = (uri: string) => {
  const url = new URL(uri)
  url.searchParams.delete('secret')
  return url.toString()
}

async function signWith(client: BunkerContext): Promise<void> {
  const event = await client.getSigningFunction()({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: 'connect secret test',
  })
  expect(verifyEvent(event)).toBe(true)
  expect(event.pubkey).toBe(ctx.activePublicKeyHex)
}

describe('bunker daemon connect secret', () => {
  beforeAll(async () => {
    relay = startRelay({ port: PORT, quiet: true })
    await relay.ready
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    bunker = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      bunkerKeyHex,
      stateDir: daemonDir,
      onUrlChange: url => { linkChanges.push(url) },
    })
  })

  afterAll(() => {
    bunker.close()
    ctx.destroy()
    relay.close()
  })

  it('puts a one-time secret in the link and moves to a new one once it is used', async () => {
    const first = bunker.url
    expect(secretOf(first)).toMatch(/^[0-9a-f]{32}$/)
    const client = await BunkerContext.connect(first, 10_000, clientDir())
    try {
      await signWith(client)
      expect(bunker.url).not.toBe(first)
      expect(secretOf(bunker.url)).toMatch(/^[0-9a-f]{32}$/)
      expect(linkChanges.at(-1)).toBe(bunker.url)
    } finally {
      client.destroy()
    }
  }, 20_000)

  it('refuses a new client whose secret was already used, with an error', async () => {
    const used = bunker.url
    const first = await BunkerContext.connect(used, 10_000, clientDir())
    first.destroy()
    await expect(BunkerContext.connect(used, 10_000, clientDir())).rejects.toThrow(/connect refused/)
  }, 30_000)

  it('refuses a new client with no secret', async () => {
    await expect(BunkerContext.connect(withoutSecret(bunker.url), 10_000, clientDir())).rejects.toThrow(/connect refused/)
  }, 20_000)

  it('leaves a new client\'s secret unused when it is refused', async () => {
    const current = bunker.url
    await expect(BunkerContext.connect(withoutSecret(current), 10_000, clientDir())).rejects.toThrow(/connect refused/)
    expect(bunker.url).toBe(current)
    const client = await BunkerContext.connect(current, 10_000, clientDir())
    client.destroy()
  }, 30_000)

  it('does not answer other requests from a client that has not connected', async () => {
    // A client that skips connect, with a key the daemon has never approved.
    const dir = clientDir()
    const bunkerPk = new URL(bunker.url).hostname
    writeStateFile('client-keys.json', { [bunkerPk]: Buffer.from(generateSecretKey()).toString('hex') }, dir)
    const client = BunkerContext.create(withoutSecret(bunker.url), dir, { paired: true })
    try {
      await expect(client.establish(2_000)).rejects.toThrow(/timed out/)
    } finally {
      client.destroy()
    }
  }, 10_000)

  it('lets an approved client reconnect with its old link', async () => {
    const dir = clientDir()
    const link = bunker.url
    const first = await BunkerContext.connect(link, 10_000, dir)
    first.destroy()
    expect(bunker.url).not.toBe(link)
    const again = await BunkerContext.connect(link, 10_000, dir)
    try {
      await signWith(again)
    } finally {
      again.destroy()
    }
  }, 30_000)

  it('keeps clients approved in an earlier run of the daemon', async () => {
    // Its own key, so the shared daemon cannot answer in the restarted one's place.
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-restart-'))
    const dir = clientDir()
    const before = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    const link = before.url
    try {
      const first = await BunkerContext.connect(link, 10_000, dir)
      first.destroy()
    } finally {
      before.close()
    }

    // Same bunker key and state, new run with a new secret: still approved.
    const restarted = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    expect(restarted.url).not.toBe(link)
    try {
      const again = await BunkerContext.connect(withoutSecret(link), 10_000, dir)
      try {
        await signWith(again)
      } finally {
        again.destroy()
      }
    } finally {
      restarted.close()
    }
  }, 30_000)

  it('open: no secret in the link, and any client is approved', async () => {
    const open = startBunker({ ctx, relays: [relay.url], quiet: true, open: true, stateDir: mkdtempSync(join(tmpdir(), 'bray-secret-open-')) })
    try {
      expect(secretOf(open.url)).toBeNull()
      const client = await BunkerContext.connect(open.url, 10_000, clientDir())
      try {
        await signWith(client)
      } finally {
        client.destroy()
      }
    } finally {
      open.close()
    }
  }, 20_000)

  it('authorized keys: no secret in the link, and other clients are dropped', async () => {
    const listed = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      authorizedKeys: [getPublicKey(generateSecretKey())],
      stateDir: mkdtempSync(join(tmpdir(), 'bray-secret-listed-')),
    })
    try {
      expect(secretOf(listed.url)).toBeNull()
      await expect(BunkerContext.connect(listed.url, 2_000, clientDir())).rejects.toThrow(/timed out/)
    } finally {
      listed.close()
    }
  }, 10_000)
})
