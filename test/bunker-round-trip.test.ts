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
    const list = await client.listIdentities()
    expect(list.length).toBe(1)
    expect(list[0].purpose).toBe('bunker')
    client.destroy()
  }, 15_000)
})
