import { describe, it, expect } from 'vitest'
import { countHardwareSigned } from '../../src/workflow/handlers.js'

describe('countHardwareSigned', () => {
  it('counts events with signer:heartwood tag', () => {
    const events = [
      { tags: [['signer', 'heartwood'], ['d', 'test']] },
      { tags: [['d', 'test']] },
      { tags: [['signer', 'heartwood']] },
    ]
    expect(countHardwareSigned(events as any)).toBe(2)
  })

  it('returns 0 when no events have the tag', () => {
    const events = [{ tags: [['d', 'test']] }]
    expect(countHardwareSigned(events as any)).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(countHardwareSigned([])).toBe(0)
  })
})
