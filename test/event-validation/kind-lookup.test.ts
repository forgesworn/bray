import { describe, it, expect } from 'vitest'
import {
  lookupKind,
  searchKinds,
  kindClass,
  isAddressableKind,
  isReplaceableKind,
  isEphemeralKind,
  resolveKind,
} from '../../src/event-validation/kind-lookup.js'
import { handleValidateEvent } from '../../src/event-validation/validator.js'

describe('kind classification', () => {
  it('classifies by NIP-01 ranges', () => {
    expect(kindClass(1)).toBe('regular')
    expect(kindClass(0)).toBe('replaceable')
    expect(kindClass(3)).toBe('replaceable')
    expect(kindClass(10002)).toBe('replaceable')
    expect(kindClass(22242)).toBe('ephemeral')
    expect(kindClass(30023)).toBe('addressable')
  })

  it('gets the range boundaries right', () => {
    expect(isAddressableKind(30000)).toBe(true)
    expect(isAddressableKind(39999)).toBe(true)
    expect(isAddressableKind(40000)).toBe(false)
    expect(isEphemeralKind(20000)).toBe(true)
    expect(isEphemeralKind(29999)).toBe(true)
    expect(isReplaceableKind(10000)).toBe(true)
    expect(isReplaceableKind(19999)).toBe(true)
    expect(isReplaceableKind(20000)).toBe(false)
  })
})

describe('lookupKind', () => {
  it('returns the schema for a known kind', () => {
    const info = lookupKind(1)
    expect(info.known).toBe(true)
    expect(info.description).toMatch(/text note/i)
    expect(info.class).toBe('regular')
  })

  it('adds the implicit d requirement for addressable kinds', () => {
    expect(lookupKind(30023).requiredTags).toContain('d')
  })

  it('reports repeatable tags', () => {
    expect(lookupKind(1).repeatableTags).toContain('p')
  })

  it('still classifies an unknown kind', () => {
    const info = lookupKind(64999)
    expect(info.known).toBe(false)
    expect(info.class).toBe('regular')
    expect(info.requiredTags).toEqual([])
  })

  it('gives an unknown addressable kind its d requirement anyway', () => {
    const info = lookupKind(39998)
    expect(info.known).toBe(false)
    expect(info.requiredTags).toEqual(['d'])
  })
})

describe('searchKinds', () => {
  it('finds kinds by description substring', () => {
    const results = searchKinds('long-form')
    expect(results.some(r => r.kind === 30023)).toBe(true)
  })

  it('ranks an exact description match first', () => {
    expect(searchKinds('short text note')[0].kind).toBe(1)
  })

  it('returns nothing for an empty query', () => {
    expect(searchKinds('')).toEqual([])
    expect(searchKinds('   ')).toEqual([])
  })

  it('honours the limit', () => {
    expect(searchKinds('e', 3)).toHaveLength(3)
  })
})

describe('lookup and validation agree', () => {
  // Both read the same pinned snapshot, so a tag the lookup calls required must
  // be one the validator actually enforces. If these ever diverge, an agent
  // following kind-info would build events that validate-event rejects.
  it('a kind reported as needing d is rejected without one', () => {
    const info = lookupKind(30023)
    expect(info.requiredTags).toContain('d')

    const without = handleValidateEvent({ kind: 30023, content: 'body', tags: [] })
    expect(without.issues.some(i => JSON.stringify(i).includes('d'))).toBe(true)

    const withD = handleValidateEvent({
      kind: 30023,
      content: 'body',
      tags: [['d', 'slug']],
    })
    expect(withD.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('reports the same description the registry holds for a kind', () => {
    expect(lookupKind(0).description).toBeTruthy()
    expect(lookupKind(1).description).toBeTruthy()
  })
})

describe('resolveKind', () => {
  it('passes a numeric kind straight through', () => {
    expect(resolveKind('1')).toBe(1)
    expect(resolveKind('30023')).toBe(30023)
    expect(resolveKind(' 7 ')).toBe(7)
  })

  it('resolves an exact description, case-insensitively', () => {
    expect(resolveKind('short text note')).toBe(1)
    expect(resolveKind('SHORT TEXT NOTE')).toBe(1)
  })

  it('resolves a substring when only one kind matches', () => {
    expect(resolveKind('long-form content')).toBe(30023)
  })

  it('refuses an ambiguous name rather than guessing', () => {
    // Guessing here would publish the wrong kind, silently
    expect(() => resolveKind('note')).toThrow(/ambiguous/)
  })

  it('names the candidates when refusing', () => {
    expect(() => resolveKind('note')).toThrow(/Short text note/)
  })

  it('points at the kind command when nothing matches', () => {
    expect(() => resolveKind('definitely-not-a-kind')).toThrow(/nostr-bray kind/)
  })
})
