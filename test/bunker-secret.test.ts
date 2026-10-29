/**
 * The bunker daemon's connect secret: a new client must connect with the
 * one-time secret from the current link; clients approved earlier reconnect
 * without it; --open and --authorized-keys keep their own rules.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { SimplePool } from 'nostr-tools/pool'
import { startRelay } from '../src/serve.js'
import { startBunker, revokeClient } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext } from '../src/bunker-context.js'
import { readStateFile, writeStateFile } from '../src/state.js'

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

/**
 * Send one raw NIP-46 request from `clientSk` and wait up to `waitMs` for the
 * reply. Resolves with the decrypted reply, or null if none came.
 */
async function rawRequest(clientSk: Uint8Array, bunkerPk: string, method: string, params: unknown[], waitMs = 1_500): Promise<{ result: string; error?: string } | null> {
  const clientPk = getPublicKey(clientSk)
  const key = getConversationKey(clientSk, bunkerPk)
  const id = Math.random().toString(36).slice(2)
  const pool = new SimplePool()
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => { sub.close(); resolve(null) }, waitMs)
      const sub = pool.subscribeMany([relay.url], { kinds: [24133], '#p': [clientPk] } as any, {
        onevent: event => {
          if (event.pubkey !== bunkerPk) return
          const reply = JSON.parse(decrypt(event.content, key))
          if (reply.id !== id) return
          clearTimeout(timer)
          sub.close()
          resolve(reply)
        },
        oneose: () => {
          const request = finalizeEvent({
            kind: 24133,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', bunkerPk]],
            content: encrypt(JSON.stringify({ id, method, params }), key),
          }, clientSk)
          void Promise.any(pool.publish([relay.url], request))
        },
      })
    })
  } finally {
    pool.destroy()
  }
}

const bunkerPkOf = (uri: string) => new URL(uri).hostname

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

  it('answers no signing or decrypt request from a client that has not connected', async () => {
    const bunkerPk = bunkerPkOf(bunker.url)
    const stranger = generateSecretKey()
    const template = JSON.stringify({ kind: 1, created_at: 1, tags: [], content: 'x' })
    const thirdParty = getPublicKey(generateSecretKey())
    for (const [method, params] of [
      ['sign_event', [template]],
      ['nip44_decrypt', [thirdParty, 'AAAA']],
      ['nip04_decrypt', [thirdParty, 'AAAA?iv=AAAA']],
      ['get_public_key', []],
    ] as const) {
      expect(await rawRequest(stranger, bunkerPk, method, [...params])).toBeNull()
    }

    // Control: the same daemon answers the same request from an approved client.
    const approved = generateSecretKey()
    const ack = await rawRequest(approved, bunkerPk, 'connect', [bunkerPk, secretOf(bunker.url)], 5_000)
    expect(ack?.result).toBe('ack')
    const signed = await rawRequest(approved, bunkerPk, 'sign_event', [template], 5_000)
    expect(verifyEvent(JSON.parse(signed!.result))).toBe(true)
  }, 30_000)

  it('refuses a wrong secret of the right length, and still ignores that client', async () => {
    const bunkerPk = bunkerPkOf(bunker.url)
    const stranger = generateSecretKey()
    const reply = await rawRequest(stranger, bunkerPk, 'connect', [bunkerPk, 'f'.repeat(32)], 5_000)
    expect(reply?.error).toMatch(/connect refused/)
    expect(await rawRequest(stranger, bunkerPk, 'get_public_key', [])).toBeNull()
  }, 20_000)

  it('lets exactly one of two clients racing with the same secret in', async () => {
    const bunkerPk = bunkerPkOf(bunker.url)
    const secret = secretOf(bunker.url)
    const replies = await Promise.all([generateSecretKey(), generateSecretKey()].map(sk =>
      rawRequest(sk, bunkerPk, 'connect', [bunkerPk, secret], 5_000)))
    expect(replies.filter(r => r?.result === 'ack')).toHaveLength(1)
    expect(replies.filter(r => /connect refused/.test(r?.error ?? ''))).toHaveLength(1)
  }, 20_000)

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

  it('keeps an unused secret across a restart', async () => {
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-keep-'))
    const before = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    const link = before.url
    before.close()
    const after = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    try {
      expect(after.url).toBe(link)
      const client = await BunkerContext.connect(link, 10_000, clientDir())
      client.destroy()
      expect(after.url).not.toBe(link)
    } finally {
      after.close()
    }
  }, 20_000)

  it('open: no secret in the link, and any client is approved', async () => {
    const openDir = mkdtempSync(join(tmpdir(), 'bray-secret-open-'))
    const open = startBunker({ ctx, relays: [relay.url], quiet: true, open: true, stateDir: openDir })
    try {
      expect(secretOf(open.url)).toBeNull()
      const client = await BunkerContext.connect(open.url, 10_000, clientDir())
      try {
        await signWith(client)
      } finally {
        client.destroy()
      }
      // Nothing is saved while open, so a later daemon without --open still
      // asks this client for the secret, and a revocation stays put.
      expect(readStateFile('approved-clients.json', openDir)).toEqual({})
      expect(open.approvedClients).toEqual([])
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
      expect(listed.requiresSecret).toBe(false)
      await expect(BunkerContext.connect(listed.url, 2_000, clientDir())).rejects.toThrow(/timed out/)
    } finally {
      listed.close()
    }
  }, 10_000)

  it('authorized keys: a listed client connects with no secret, and open is ignored', async () => {
    const clientSk = generateSecretKey()
    const listed = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      open: true,
      authorizedKeys: [getPublicKey(clientSk)],
      stateDir: mkdtempSync(join(tmpdir(), 'bray-secret-listed2-')),
    })
    try {
      expect(secretOf(listed.url)).toBeNull()
      expect(listed.requiresSecret).toBe(false)
      const ack = await rawRequest(clientSk, listed.pubkey, 'connect', [listed.pubkey, ''], 5_000)
      expect(ack?.result).toBe('ack')
      // open is ignored: an unlisted client still gets nothing.
      expect(await rawRequest(generateSecretKey(), listed.pubkey, 'connect', [listed.pubkey, ''])).toBeNull()
    } finally {
      listed.close()
    }
  }, 20_000)

  it('reports clients approved in earlier runs', () => {
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-list-'))
    const pk = getPublicKey(Buffer.from(key, 'hex'))
    const known = getPublicKey(generateSecretKey())
    writeStateFile('approved-clients.json', { [pk]: [known] }, state)
    const b = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    try {
      expect(b.approvedClients).toEqual([known])
      expect(b.requiresSecret).toBe(true)
    } finally {
      b.close()
    }
  })
  it('revoking a client cuts it off from a running daemon, and later approvals do not bring it back', async () => {
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-revoke-'))
    const b = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    try {
      const first = generateSecretKey()
      const firstSecret = secretOf(b.url)
      const ack = await rawRequest(first, b.pubkey, 'connect', [b.pubkey, firstSecret], 5_000)
      expect(ack?.result).toBe('ack')
      expect((await rawRequest(first, b.pubkey, 'get_public_key', [], 5_000))?.result).toBe(ctx.activePublicKeyHex)

      expect(revokeClient(getPublicKey(first), state)).toBe(1)
      expect(await rawRequest(first, b.pubkey, 'get_public_key', [])).toBeNull()
      expect(b.approvedClients).toEqual([])

      // Approving another client must not write the revoked key back.
      const second = generateSecretKey()
      expect((await rawRequest(second, b.pubkey, 'connect', [b.pubkey, secretOf(b.url)], 5_000))?.result).toBe('ack')
      const onDisk = readStateFile<Record<string, string[]>>('approved-clients.json', state)[b.pubkey]
      expect(onDisk).toEqual([getPublicKey(second)])

      // The revoked client cannot get back in with its old link either.
      const refused = await rawRequest(first, b.pubkey, 'connect', [b.pubkey, firstSecret], 5_000)
      expect(refused?.error).toMatch(/connect refused/)
    } finally {
      b.close()
    }
  }, 30_000)

  it('revokeClient removes the key under every bunker and reports none when absent', () => {
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-revoke2-'))
    const gone = getPublicKey(generateSecretKey())
    const kept = getPublicKey(generateSecretKey())
    writeStateFile('approved-clients.json', { a: [gone, kept], b: [gone], c: [kept] }, state)
    expect(revokeClient(gone, state)).toBe(2)
    expect(readStateFile('approved-clients.json', state)).toEqual({ a: [kept], b: [], c: [kept] })
    expect(revokeClient(gone, state)).toBe(0)
  })

  it('an unreadable approvals file is never overwritten, and approved clients are refused until it is fixed', async () => {
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-corrupt-'))
    const b = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    const file = join(state, 'approved-clients.json')
    try {
      const first = generateSecretKey()
      expect((await rawRequest(first, b.pubkey, 'connect', [b.pubkey, secretOf(b.url)], 5_000))?.result).toBe('ack')
      const good = readFileSync(file, 'utf-8')

      writeFileSync(file, '{ not json')
      expect(await rawRequest(first, b.pubkey, 'get_public_key', [])).toBeNull()
      // A new client still gets in with the secret, but the file is left as it is.
      const second = generateSecretKey()
      expect((await rawRequest(second, b.pubkey, 'connect', [b.pubkey, secretOf(b.url)], 5_000))?.result).toBe('ack')
      expect(readFileSync(file, 'utf-8')).toBe('{ not json')
      expect(() => revokeClient(getPublicKey(first), state)).toThrow(/unreadable/)

      writeFileSync(file, good)
      expect((await rawRequest(first, b.pubkey, 'get_public_key', [], 5_000))?.result).toBe(ctx.activePublicKeyHex)
    } finally {
      b.close()
    }
  }, 30_000)

  it('a client authorised on disk while the daemon runs connects without the secret', async () => {
    const key = Buffer.from(generateSecretKey()).toString('hex')
    const state = mkdtempSync(join(tmpdir(), 'bray-secret-authorize-'))
    const b = startBunker({ ctx, relays: [relay.url], quiet: true, bunkerKeyHex: key, stateDir: state })
    try {
      const app = generateSecretKey()
      expect((await rawRequest(app, b.pubkey, 'connect', [b.pubkey, ''], 5_000))?.error).toMatch(/connect refused/)
      writeStateFile('approved-clients.json', { [b.pubkey]: [getPublicKey(app)] }, state)
      expect((await rawRequest(app, b.pubkey, 'connect', [b.pubkey, ''], 5_000))?.result).toBe('ack')
      expect((await rawRequest(app, b.pubkey, 'get_public_key', [], 5_000))?.result).toBe(ctx.activePublicKeyHex)
      expect(b.approvedClients).toEqual([getPublicKey(app)])
      // The secret was not used, so the link has not moved on.
      expect(secretOf(b.url)).not.toBeNull()
    } finally {
      b.close()
    }
  }, 30_000)
})
