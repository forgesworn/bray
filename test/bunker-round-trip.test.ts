/**
 * Bunker round-trip test — server + client via our test relay.
 *
 * 1. Start in-memory relay
 * 2. Start bunker server (holds the key)
 * 3. Connect bunker client
 * 4. Sign an event via the bunker
 * 5. Verify the signature
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext } from '../src/bunker-context.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

let relay: ReturnType<typeof startRelay>
let bunkerServer: ReturnType<typeof startBunker>
let ctx: IdentityContext

describe('bunker round-trip', () => {
  beforeAll(() => {
    // Start test relay
    relay = startRelay({ port: 19648, quiet: true })

    // Start bunker server with local context
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
    bunkerServer = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
    })
  })

  afterAll(() => {
    bunkerServer.close()
    ctx.destroy()
    relay.close()
  })

  it('bunker server starts and returns a URI', () => {
    expect(bunkerServer.url).toMatch(/^bunker:\/\//)
    expect(bunkerServer.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(bunkerServer.npub).toMatch(/^npub1/)
  })

  it('client connects to bunker and gets public key', async () => {
    const client = await BunkerContext.connect(bunkerServer.url)
    await client.resolvePublicKey()
    expect(client.activeNpub).toBe(ctx.activeNpub)
    expect(client.activePublicKeyHex).toBe(ctx.activePublicKeyHex)
    client.destroy()
  }, 15_000)

  it('client signs an event via the bunker', async () => {
    const client = await BunkerContext.connect(bunkerServer.url)
    const sign = client.getSigningFunction()

    const event = await sign({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'signed via bunker!',
    })

    expect(event.kind).toBe(1)
    expect(event.content).toBe('signed via bunker!')
    expect(event.pubkey).toBe(ctx.activePublicKeyHex)
    expect(verifyEvent(event)).toBe(true)

    client.destroy()
  }, 15_000)

  it('client lists identities', async () => {
    const client = await BunkerContext.connect(bunkerServer.url)
    await client.resolvePublicKey()
    const list = await client.listIdentities()
    expect(list.length).toBe(1)
    expect(list[0].purpose).toBe('bunker')
    client.destroy()
  }, 15_000)

  it('persists approved client pubkey after connect', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { readStateFile } = await import('../src/state.js')

    const stateDir = mkdtempSync(join(tmpdir(), 'bray-approval-test-'))

    // Start a separate bunker with stateDir
    const bunker2 = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      stateDir,
    })

    // Connect a client — this should auto-approve and persist
    const client = await BunkerContext.connect(bunker2.url)
    // Give the bunker a moment to process and persist
    await new Promise(r => setTimeout(r, 200))

    const approvals = readStateFile<Record<string, string[]>>('approved-clients.json', stateDir)
    expect(approvals[bunker2.pubkey]).toBeDefined()
    expect(approvals[bunker2.pubkey].length).toBeGreaterThanOrEqual(1)

    client.destroy()
    bunker2.close()
  }, 15_000)

  it('loads persisted approvals on startup', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { writeStateFile } = await import('../src/state.js')
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure')

    const stateDir = mkdtempSync(join(tmpdir(), 'bray-load-test-'))

    // Pre-generate a stable bunker key so bunker3 reuses the same pubkey
    const bunkerSk = generateSecretKey()
    const bunkerKeyHex = Buffer.from(bunkerSk).toString('hex')

    // Pre-generate a client key
    const clientSk = generateSecretKey()
    const clientPk = getPublicKey(clientSk)
    const bunkerPk = getPublicKey(bunkerSk)

    // Write the client key as pre-approved for this bunker pubkey
    writeStateFile('approved-clients.json', {
      [bunkerPk]: [clientPk],
    }, stateDir)

    // Also write the client secret into client-keys.json so resolveClientKey()
    // reuses this key instead of generating a new random one
    writeStateFile('client-keys.json', {
      [bunkerPk]: Buffer.from(clientSk).toString('hex'),
    }, stateDir)

    // Start bunker with a dummy authorised key only — no open access
    const bunker3 = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      authorizedKeys: ['0'.repeat(64)],
      bunkerKeyHex,
      stateDir,
    })

    // Persisted approval should be loaded at startup — clientPk is now authorised
    // Connect using the stateDir so resolveClientKey finds the pre-seeded client key
    const client = await BunkerContext.connect(bunker3.url, 15_000, stateDir)
    await client.resolvePublicKey()
    expect(client.activeNpub).toBe(ctx.activeNpub)

    client.destroy()
    bunker3.close()
  }, 15_000)
})
