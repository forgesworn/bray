import { describe, it, expect } from 'vitest'
import { isHeartwoodContext } from '../../src/heartwood-context.js'

describe('attestation signer tagging', () => {
  it('isHeartwoodContext returns false for non-Heartwood context', () => {
    const fakeCtx = { activeNpub: 'npub1test' }
    expect(isHeartwoodContext(fakeCtx)).toBe(false)
  })
})
