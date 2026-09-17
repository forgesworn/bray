import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { startRelay } from '../src/serve.js'
import { startBunker } from '../src/bunker.js'
import { IdentityContext } from '../src/context.js'
import { BunkerContext, TimeoutError } from '../src/bunker-context.js'
import { HeartwoodContext, isHeartwoodIdentitiesResponse } from '../src/heartwood-context.js'

/**
 * A minimal stand-in for a connected BunkerContext, exposing just the
 * protected `signer.sendRequest` that `HeartwoodContext.probe()` reads.
 * Lets the probe's error-classification branches be exercised without a
 * real relay/bunker round trip (and without waiting out the real
 * 60-second REQUEST_TIMEOUT_MS for the timeout case).
 */
function fakeBase(sendRequest: (method: string, params: string[]) => Promise<string>): BunkerContext {
  return { signer: { sendRequest } } as unknown as BunkerContext
}

describe('isHeartwoodIdentitiesResponse', () => {
  const validNpub = 'npub1' + 'a'.repeat(58)

  it('accepts an empty array (freshly initialised device)', () => {
    expect(isHeartwoodIdentitiesResponse('[]')).toBe(true)
  })

  it('accepts an array of {npub} objects', () => {
    expect(isHeartwoodIdentitiesResponse(JSON.stringify([{ npub: validNpub }]))).toBe(true)
    expect(isHeartwoodIdentitiesResponse(JSON.stringify([
      { npub: validNpub, purpose: 'root' },
      { npub: validNpub, index: 0 },
    ]))).toBe(true)
  })

  it('rejects bare JSON primitives masquerading as a list', () => {
    expect(isHeartwoodIdentitiesResponse('42')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('"heartwood"')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('true')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('null')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('{}')).toBe(false)
  })

  it('rejects arrays whose entries lack npub', () => {
    expect(isHeartwoodIdentitiesResponse(JSON.stringify([{ foo: 'bar' }]))).toBe(false)
    expect(isHeartwoodIdentitiesResponse(JSON.stringify(['plain string']))).toBe(false)
    expect(isHeartwoodIdentitiesResponse(JSON.stringify([null]))).toBe(false)
    expect(isHeartwoodIdentitiesResponse(JSON.stringify([{ npub: 123 }]))).toBe(false)
  })

  it('rejects unparseable input', () => {
    expect(isHeartwoodIdentitiesResponse('')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('not json')).toBe(false)
    expect(isHeartwoodIdentitiesResponse('[unterminated')).toBe(false)
  })
})

describe('HeartwoodContext.probe error classification', () => {
  it('(a) method unknown -- returns null, silently, as a plain bunker', async () => {
    const base = fakeBase(() => Promise.reject('unsupported method: heartwood_list_identities'))
    const hw = await HeartwoodContext.probe(base)
    expect(hw).toBeNull()
  })

  it('(a) treats an unrecognised/ambiguous error the same as method-unknown', async () => {
    // Deliberately not matching either the "unauthorised" or "method unknown"
    // patterns -- probe() should stay conservative and not claim Heartwood.
    const base = fakeBase(() => Promise.reject('relay connection reset'))
    const hw = await HeartwoodContext.probe(base)
    expect(hw).toBeNull()
  })

  it('(b) unauthorised/denied -- IS a Heartwood, listing marked unavailable', async () => {
    const base = fakeBase(() => Promise.reject('unauthorised'))
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()
    expect(hw).toBeInstanceOf(HeartwoodContext)
    expect(hw!.listingAvailable).toBe(false)
    expect(hw!.listingUnavailableReason).toBe('denied')
    expect(hw!.listingUnavailableMessage).toMatch(/denied identity listing/i)
  })

  it('(b) also recognises the American spelling and "denied" wording', async () => {
    const base = fakeBase(() => Promise.reject('request denied by policy'))
    const hw = await HeartwoodContext.probe(base)
    expect(hw!.listingUnavailableReason).toBe('denied')
  })

  it('(c) timeout -- IS a Heartwood, listing marked unavailable pending approval', async () => {
    const base = fakeBase(() => Promise.reject(new TimeoutError('heartwood probe timed out after 60000ms')))
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()
    expect(hw).toBeInstanceOf(HeartwoodContext)
    expect(hw!.listingAvailable).toBe(false)
    expect(hw!.listingUnavailableReason).toBe('pending-approval')
    expect(hw!.listingUnavailableMessage).toMatch(/awaiting approval on the device/i)
  })

  it('a HeartwoodContext with listing unavailable rejects listIdentities() without another device round trip', async () => {
    const sendRequest = vi.fn(() => Promise.reject('unauthorised'))
    const base = fakeBase(sendRequest)
    const hw = await HeartwoodContext.probe(base)
    expect(hw).not.toBeNull()

    sendRequest.mockClear()
    await expect(hw!.listIdentities()).rejects.toThrow(/denied identity listing/i)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})

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
    expect(hw!.listingAvailable).toBe(true)
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
