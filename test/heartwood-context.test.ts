import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext } from '../src/bunker-context.js'
import { HeartwoodContext } from '../src/heartwood-context.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

let relay: ReturnType<typeof startRelay>
let bunkerServer: ReturnType<typeof startBunker>
let ctx: IdentityContext

describe('HeartwoodContext', () => {
  beforeAll(() => {
    relay = startRelay({ port: 19649, quiet: true })
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

  it('probe returns null for a standard NIP-46 bunker', async () => {
    const base = await BunkerContext.connect(bunkerServer.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).toBeNull()
    base.destroy()
  }, 15_000)
})

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('with Heartwood extensions', () => {
  let hwRelay: ReturnType<typeof startRelay>
  let hwBunker: ReturnType<typeof startBunker>
  let hwCtx: IdentityContext

  beforeAll(() => {
    hwRelay = startRelay({ port: 19650, quiet: true })
    hwCtx = new IdentityContext(TEST_MNEMONIC, 'mnemonic')
    hwBunker = startBunker({
      ctx: hwCtx,
      relays: [hwRelay.url],
      quiet: true,
      heartwoodExtensions: true,
    })
  })

  afterAll(() => {
    hwBunker.close()
    hwCtx.destroy()
    hwRelay.close()
  })

  it('probe upgrades to HeartwoodContext', async () => {
    const base = await BunkerContext.connect(hwBunker.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()
    expect(hw).toBeInstanceOf(HeartwoodContext)
    hw!.destroy()
  }, 15_000)

  it('derive returns a PublicIdentity', async () => {
    const base = await BunkerContext.connect(hwBunker.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()

    const identity = await hw!.derive('test-purpose', 0)
    expect(identity.npub).toMatch(/^npub1/)
    expect(identity.purpose).toBe('test-purpose')
    expect(identity.index).toBe(0)

    hw!.destroy()
  }, 15_000)

  it('listIdentities returns identities after derive', async () => {
    const base = await BunkerContext.connect(hwBunker.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()

    await hw!.derive('list-test', 0)
    const list = await hw!.listIdentities()
    expect(list.length).toBeGreaterThanOrEqual(1)

    hw!.destroy()
  }, 15_000)

  it('switch changes active identity', async () => {
    const base = await BunkerContext.connect(hwBunker.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()

    const derived = await hw!.derive('switch-test', 0)
    await hw!.switch('switch-test', 0)
    expect(hw!.activeNpub).toBe(derived.npub)

    await hw!.switch('master')
    hw!.destroy()
  }, 15_000)

  it('prove returns a LinkageProof', async () => {
    const base = await BunkerContext.connect(hwBunker.url)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()

    await hw!.derive('proof-test', 0)
    await hw!.switch('proof-test', 0)
    const proof = await hw!.prove('blind')
    expect(proof.masterPubkey).toBeDefined()
    expect(proof.childPubkey).toBeDefined()
    expect(proof.signature).toBeDefined()

    hw!.destroy()
  }, 15_000)
})
