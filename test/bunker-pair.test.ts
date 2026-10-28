/**
 * nostrconnect:// pairing, client side.
 *
 * The test plays the signer app: it reads the URI bray prints and answers it
 * from a bunker key on the in-memory relay. bray's own bunker daemon then
 * serves the later requests. That daemon approves any client, so this proves
 * bray's half only: that it pairs, saves the right state and signs through the
 * saved signer without sending `connect`. Whether a given signer app accepts
 * the reconnect has to be checked against that app.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getConversationKey, encrypt } from 'nostr-tools/nip44'
import { finalizeEvent, getPublicKey, generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext, parseBunkerUri } from '../src/bunker-context.js'
import { pairWithNostrConnect, PairingDeclinedError } from '../src/bunker-pair.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'
const PORT = 19651
const PORT_2 = 19652

let relay: ReturnType<typeof startRelay>
let relay2: ReturnType<typeof startRelay>
let bunkerServer: ReturnType<typeof startBunker>
let ctx: IdentityContext
const bunkerSk = generateSecretKey()
const bunkerPk = getPublicKey(bunkerSk)
let stateDir: string
let answerPool: SimplePool

/** Answer a nostrconnect:// URI the way a signer app does. */
async function answer(uri: string, override: { secret?: string; fromSk?: Uint8Array } = {}): Promise<void> {
  const url = new URL(uri)
  const clientPk = url.hostname
  const secret = override.secret ?? url.searchParams.get('secret')!
  const fromSk = override.fromSk ?? bunkerSk
  const content = encrypt(JSON.stringify({ id: 'pair', result: secret }), getConversationKey(fromSk, clientPk))
  const event = finalizeEvent({
    kind: 24133,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', clientPk]],
    content,
  }, fromSk)
  await Promise.any(answerPool.publish([relay.url], event))
}

function readState<T>(name: string): T {
  return JSON.parse(readFileSync(join(stateDir, name), 'utf-8')) as T
}

describe('bunker pair (nostrconnect://)', () => {
  beforeAll(async () => {
    relay = startRelay({ port: PORT, quiet: true })
    relay2 = startRelay({ port: PORT_2, quiet: true })
    await Promise.all([relay.ready, relay2.ready])
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    bunkerServer = startBunker({
      ctx,
      relays: [relay.url],
      bunkerKeyHex: Buffer.from(bunkerSk).toString('hex'),
      quiet: true,
      stateDir: mkdtempSync(join(tmpdir(), 'bray-pair-bunker-')),
    })
    answerPool = new SimplePool()
  })

  afterAll(() => {
    answerPool.destroy()
    bunkerServer.close()
    ctx.destroy()
    relay.close()
    relay2.close()
  })

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'bray-pair-state-'))
  })

  it('prints a nostrconnect URI with the relays, a fresh secret and bray\'s name', async () => {
    let seen = ''
    await expect(pairWithNostrConnect({
      relays: [relay.url],
      allowPrivateRelays: true,
      timeoutMs: 300,
      stateDir,
      onUri: uri => { seen = uri },
    })).rejects.toThrow(/no signer answered within/)
    const url = new URL(seen)
    expect(url.protocol).toBe('nostrconnect:')
    expect(url.hostname).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.getAll('relay')).toEqual([relay.url])
    expect(url.searchParams.get('secret')).toMatch(/^[0-9a-f]{32}$/)
    expect(url.searchParams.get('name')).toBe('nostr-bray')
  })

  it('pairs, saves a secret-free paired URI and the approved client key, then signs without connect', async () => {
    let clientPk = ''
    const result = await pairWithNostrConnect({
      relays: [relay.url],
      allowPrivateRelays: true,
      timeoutMs: 10_000,
      stateDir,
      onUri: uri => {
        clientPk = new URL(uri).hostname
        void answer(uri)
      },
    })

    expect(result.signerPubkey).toBe(bunkerPk)
    expect(result.npub).toBe(ctx.activeNpub)
    expect(result.relays).toEqual([relay.url])

    const saved = readState<{ uri: string; paired: boolean }>('bunker-uri')
    expect(saved.paired).toBe(true)
    expect(saved.uri).toBe(result.bunkerUri)
    expect(saved.uri).not.toContain('secret')
    expect(parseBunkerUri(saved.uri)).toEqual({ pubkey: bunkerPk, relays: [relay.url], connectSecret: undefined })
    expect(statSync(join(stateDir, 'bunker-uri')).mode & 0o777).toBe(0o600)

    const keys = readState<Record<string, string>>('client-keys.json')
    expect(getPublicKey(Buffer.from(keys[bunkerPk], 'hex'))).toBe(clientPk)
    expect(statSync(join(stateDir, 'client-keys.json')).mode & 0o777).toBe(0o600)

    // Next start: same client key, no connect, signs through the signer.
    const next = BunkerContext.create(saved.uri, stateDir, { paired: true })
    const sent: string[] = []
    const signer = (next as unknown as { signer: { sendRequest: (m: string, p: string[]) => Promise<string> } }).signer
    const original = signer.sendRequest.bind(signer)
    signer.sendRequest = (method, params) => { sent.push(method); return original(method, params) }
    try {
      await next.establish(10_000)
      expect(next.activePublicKeyHex).toBe(ctx.activePublicKeyHex)
      const event = await next.getSigningFunction()({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'signed after pairing',
      })
      expect(verifyEvent(event)).toBe(true)
      expect(event.pubkey).toBe(ctx.activePublicKeyHex)
      expect(sent).not.toContain('connect')
      expect(sent).toContain('get_public_key')
    } finally {
      next.destroy()
    }
  }, 30_000)

  it('ignores an answer with the wrong secret', async () => {
    await expect(pairWithNostrConnect({
      relays: [relay.url],
      allowPrivateRelays: true,
      timeoutMs: 1_500,
      stateDir,
      onUri: uri => { void answer(uri, { secret: 'not-the-secret' }) },
    })).rejects.toThrow(/no signer answered within/)
    expect(() => readState('bunker-uri')).toThrow()
    expect(() => readState('client-keys.json')).toThrow()
  }, 10_000)

  it('a URI saved by bunker connect (no paired flag) still sends connect', async () => {
    const next = BunkerContext.create(bunkerServer.url, stateDir)
    const sent: string[] = []
    const signer = (next as unknown as { signer: { sendRequest: (m: string, p: string[]) => Promise<string> } }).signer
    const original = signer.sendRequest.bind(signer)
    signer.sendRequest = (method, params) => { sent.push(method); return original(method, params) }
    try {
      await next.establish(10_000)
      expect(sent[0]).toBe('connect')
    } finally {
      next.destroy()
    }
  }, 20_000)

  it('saves nothing when the user declines the account', async () => {
    let offered = ''
    await expect(pairWithNostrConnect({
      relays: [relay.url],
      allowPrivateRelays: true,
      timeoutMs: 10_000,
      stateDir,
      onUri: uri => { void answer(uri) },
      confirm: async npub => { offered = npub; return false },
    })).rejects.toBeInstanceOf(PairingDeclinedError)
    expect(offered).toBe(ctx.activeNpub)
    expect(() => readState('bunker-uri')).toThrow()
    expect(() => readState('client-keys.json')).toThrow()
  }, 20_000)

  it('times out on time with several relays', async () => {
    const started = Date.now()
    await expect(pairWithNostrConnect({
      relays: [relay.url, relay2.url],
      allowPrivateRelays: true,
      timeoutMs: 500,
      stateDir,
      onUri: () => {},
    })).rejects.toThrow(/no signer answered within/)
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('reports unreachable relays rather than a timeout, without showing a URI', async () => {
    const onUri = () => { throw new Error('should not be called') }
    await expect(pairWithNostrConnect({
      relays: ['ws://127.0.0.1:1'],
      allowPrivateRelays: true,
      timeoutMs: 10_000,
      stateDir,
      onUri,
    })).rejects.toThrow(/could not reach any relay/)
  }, 15_000)

  it('leaves out an unreachable relay and pairs over the rest', async () => {
    const dropped: string[] = []
    let offered: string[] = []
    const result = await pairWithNostrConnect({
      relays: ['ws://127.0.0.1:1', relay.url],
      allowPrivateRelays: true,
      timeoutMs: 10_000,
      stateDir,
      onRelayUnreachable: r => { dropped.push(r) },
      onUri: uri => {
        offered = new URL(uri).searchParams.getAll('relay')
        void answer(uri)
      },
    })
    expect(dropped).toEqual(['ws://127.0.0.1:1'])
    expect(offered).toEqual([relay.url])
    expect(result.relays).toEqual([relay.url])
    expect(parseBunkerUri(readState<{ uri: string }>('bunker-uri').uri).relays).toEqual([relay.url])
  }, 30_000)

  it('refuses clearnet relays when Tor is configured', async () => {
    const onUri = () => { throw new Error('should not be called') }
    await expect(pairWithNostrConnect({
      relays: ['wss://relay.example.com'], torProxy: 'socks5h://127.0.0.1:9050', stateDir, onUri,
    })).rejects.toThrow(/TOR_PROXY is set/)
  })

  it('sends pairing traffic through the Tor proxy when one is set', async () => {
    // The local relay is reachable directly, but not through a dead proxy.
    const onUri = () => { throw new Error('should not be called') }
    await expect(pairWithNostrConnect({
      relays: [relay.url],
      allowPrivateRelays: true,
      torProxy: 'socks5h://127.0.0.1:1',
      allowClearnetWithTor: true,
      timeoutMs: 10_000,
      stateDir,
      onUri,
    })).rejects.toThrow(/could not reach any relay/)
  }, 20_000)

  it('a paired signer with no stored client key fails with a re-pair hint', () => {
    const uri = `bunker://${bunkerPk}?relay=${encodeURIComponent(relay.url)}`
    expect(() => BunkerContext.create(uri, stateDir, { paired: true })).toThrow(/bunker pair/)
    // Not paired: a key is generated as before.
    BunkerContext.create(uri, stateDir).destroy()
  })

  it('rejects bad relay lists before showing a URI', async () => {
    const onUri = () => { throw new Error('should not be called') }
    await expect(pairWithNostrConnect({ relays: [], stateDir, onUri })).rejects.toThrow(/at least one relay/)
    await expect(pairWithNostrConnect({ relays: ['https://example.com'], stateDir, onUri })).rejects.toThrow(/not a relay URL/)
    await expect(pairWithNostrConnect({ relays: ['ws://relay.example.com'], stateDir, onUri })).rejects.toThrow(/Plaintext ws/)
  })
})
