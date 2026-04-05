import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseAnnounceEvent,
  parseL402ChallengeHeader,
  extractBolt11AmountSats,
  handleMarketplaceCompare,
  handleMarketplaceDiscover,
  handleMarketplaceInspect,
  handleMarketplaceSearch,
  handleMarketplaceReputation,
  handleMarketplaceProbe,
  handleMarketplaceCall,
  handleMarketplaceAnnounce,
  handleMarketplaceRetire,
  storeCredential,
  getCredential,
  clearCredentials,
  buildL402AuthHeader,
  L402_ANNOUNCE_KIND,
} from '../../src/marketplace/handlers.js'
import type { ParsedService } from '../../src/marketplace/handlers.js'
import { IdentityContext } from '../../src/context.js'

// --- parseAnnounceEvent ---

describe('parseAnnounceEvent', () => {
  const baseTags: string[][] = [
    ['d', 'my-service'],
    ['name', 'Test Service'],
    ['url', 'https://api.example.com'],
    ['about', 'A test service'],
    ['pmi', 'l402', 'https://api.example.com'],
    ['price', 'query', '100', 'sats'],
    ['t', 'ai'],
    ['t', 'search'],
    ['picture', 'https://example.com/logo.png'],
  ]

  function makeEvent(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: L402_ANNOUNCE_KIND,
      created_at: 1700000000,
      tags: baseTags,
      content: JSON.stringify({
        capabilities: [
          { name: 'query', description: 'Run a search query', endpoint: '/query' },
          { name: 'summarise', description: 'Summarise results' },
        ],
        version: '1.0.0',
      }),
      sig: 'c'.repeat(128),
      ...overrides,
    } as any
  }

  it('parses all fields from a well-formed event', () => {
    const result = parseAnnounceEvent(makeEvent())

    expect(result.id).toBe('a'.repeat(64))
    expect(result.identifier).toBe('my-service')
    expect(result.name).toBe('Test Service')
    expect(result.urls).toEqual(['https://api.example.com'])
    expect(result.about).toBe('A test service')
    expect(result.pubkey).toBe('b'.repeat(64))
    expect(result.picture).toBe('https://example.com/logo.png')
    expect(result.createdAt).toBe(1700000000)
    expect(result.version).toBe('1.0.0')
  })

  it('parses payment methods', () => {
    const result = parseAnnounceEvent(makeEvent())
    expect(result.paymentMethods).toEqual([['l402', 'https://api.example.com']])
  })

  it('parses pricing entries', () => {
    const result = parseAnnounceEvent(makeEvent())
    expect(result.pricing).toEqual([
      { capability: 'query', amount: '100', currency: 'sats' },
    ])
  })

  it('parses topics', () => {
    const result = parseAnnounceEvent(makeEvent())
    expect(result.topics).toEqual(['ai', 'search'])
  })

  it('parses capabilities from content JSON', () => {
    const result = parseAnnounceEvent(makeEvent())
    expect(result.capabilities).toHaveLength(2)
    expect(result.capabilities[0]).toEqual({
      name: 'query',
      description: 'Run a search query',
      endpoint: '/query',
    })
    expect(result.capabilities[1]).toEqual({
      name: 'summarise',
      description: 'Summarise results',
    })
  })

  it('handles missing tags gracefully', () => {
    const result = parseAnnounceEvent({
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      kind: L402_ANNOUNCE_KIND,
      created_at: 1700000000,
      tags: [],
      content: '{}',
      sig: 'c'.repeat(128),
    } as any)

    expect(result.identifier).toBe('')
    expect(result.name).toBe('')
    expect(result.urls).toEqual([])
    expect(result.about).toBe('')
    expect(result.paymentMethods).toEqual([])
    expect(result.pricing).toEqual([])
    expect(result.topics).toEqual([])
    expect(result.capabilities).toEqual([])
    expect(result.picture).toBeUndefined()
    expect(result.version).toBeUndefined()
  })

  it('handles invalid JSON content', () => {
    const result = parseAnnounceEvent(makeEvent({ content: 'not json' }))
    expect(result.capabilities).toEqual([])
    expect(result.version).toBeUndefined()
  })

  it('handles content with malformed capabilities', () => {
    const result = parseAnnounceEvent(makeEvent({
      content: JSON.stringify({
        capabilities: [
          { name: 123, description: 'invalid name type' },
          { name: 'valid', description: 'ok' },
          'not an object',
        ],
      }),
    }))
    // Only the valid capability should survive
    expect(result.capabilities).toHaveLength(1)
    expect(result.capabilities[0].name).toBe('valid')
  })

  it('parses multiple URLs', () => {
    const result = parseAnnounceEvent(makeEvent({
      tags: [
        ['d', 'svc'],
        ['url', 'https://a.example.com'],
        ['url', 'https://b.example.com'],
        ['url', 'https://c.example.com'],
      ],
    }))
    expect(result.urls).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ])
  })

  it('parses multiple payment methods', () => {
    const result = parseAnnounceEvent(makeEvent({
      tags: [
        ['d', 'svc'],
        ['pmi', 'l402', 'https://api.example.com'],
        ['pmi', 'cashu', 'https://mint.example.com'],
      ],
    }))
    expect(result.paymentMethods).toEqual([
      ['l402', 'https://api.example.com'],
      ['cashu', 'https://mint.example.com'],
    ])
  })

  it('truncates excessively long capability fields', () => {
    const longName = 'x'.repeat(1000)
    const longDesc = 'y'.repeat(5000)
    const result = parseAnnounceEvent(makeEvent({
      content: JSON.stringify({
        capabilities: [{ name: longName, description: longDesc }],
      }),
    }))
    expect(result.capabilities[0].name.length).toBe(500)
    expect(result.capabilities[0].description.length).toBe(2000)
  })
})

// --- parseL402ChallengeHeader ---

describe('parseL402ChallengeHeader', () => {
  it('parses L402 challenge with quoted values', () => {
    const header = 'L402 macaroon="AgEEbHNhdA==", invoice="lnbc100n1abc123"'
    const result = parseL402ChallengeHeader(header)
    expect(result).toEqual({
      macaroon: 'AgEEbHNhdA==',
      invoice: 'lnbc100n1abc123',
    })
  })

  it('parses L402 challenge with unquoted values', () => {
    const header = 'L402 macaroon=AgEEbHNhdA==, invoice=lnbc100n1abc123'
    const result = parseL402ChallengeHeader(header)
    expect(result).toEqual({
      macaroon: 'AgEEbHNhdA==',
      invoice: 'lnbc100n1abc123',
    })
  })

  it('parses LSAT challenge (legacy format)', () => {
    const header = 'LSAT macaroon="AgEEbHNhdA==", invoice="lnbc500u1xyz789"'
    const result = parseL402ChallengeHeader(header)
    expect(result).toEqual({
      macaroon: 'AgEEbHNhdA==',
      invoice: 'lnbc500u1xyz789',
    })
  })

  it('is case-insensitive for scheme prefix', () => {
    const header = 'l402 macaroon="AgEEbHNhdA==", invoice="lnbc100n1abc123"'
    const result = parseL402ChallengeHeader(header)
    expect(result).not.toBeNull()
    expect(result!.macaroon).toBe('AgEEbHNhdA==')
  })

  it('returns null for non-L402 header', () => {
    expect(parseL402ChallengeHeader('Bearer token123')).toBeNull()
    expect(parseL402ChallengeHeader('Basic dXNlcjpwYXNz')).toBeNull()
  })

  it('returns null for empty header', () => {
    expect(parseL402ChallengeHeader('')).toBeNull()
  })

  it('returns null for L402 with missing macaroon', () => {
    const header = 'L402 invoice="lnbc100n1abc123"'
    expect(parseL402ChallengeHeader(header)).toBeNull()
  })

  it('returns null for L402 with missing invoice', () => {
    const header = 'L402 macaroon="AgEEbHNhdA=="'
    expect(parseL402ChallengeHeader(header)).toBeNull()
  })

  it('handles lntb (testnet) invoices', () => {
    const header = 'L402 macaroon="AgEEbHNhdA==", invoice="lntb100n1abc123"'
    const result = parseL402ChallengeHeader(header)
    expect(result).not.toBeNull()
    expect(result!.invoice).toBe('lntb100n1abc123')
  })

  it('handles lnbcrt (regtest) invoices', () => {
    const header = 'L402 macaroon="AgEEbHNhdA==", invoice="lnbcrt100n1abc123"'
    const result = parseL402ChallengeHeader(header)
    expect(result).not.toBeNull()
    expect(result!.invoice).toBe('lnbcrt100n1abc123')
  })
})

// --- extractBolt11AmountSats ---

describe('extractBolt11AmountSats', () => {
  it('extracts amount with milli-BTC multiplier', () => {
    // lnbc1m = 1 * 100_000_000 msats / 1000 = 100_000 sats
    expect(extractBolt11AmountSats('lnbc1m1abc')).toBe(100_000)
  })

  it('extracts amount with micro-BTC multiplier', () => {
    // lnbc500u = 500 * 100_000 msats / 1000 = 50_000 sats
    expect(extractBolt11AmountSats('lnbc500u1abc')).toBe(50_000)
  })

  it('extracts amount with nano-BTC multiplier', () => {
    // lnbc100n = 100 * 100 msats / 1000 = 10 sats
    expect(extractBolt11AmountSats('lnbc100n1abc')).toBe(10)
  })

  it('extracts amount with pico-BTC multiplier', () => {
    // lnbc10000p = 10000 * 0.1 msats / 1000 = 1 sat
    expect(extractBolt11AmountSats('lnbc10000p1abc')).toBe(1)
  })

  it('returns undefined for invoice without multiplier', () => {
    // No multiplier suffix
    expect(extractBolt11AmountSats('lnbc12345')).toBeUndefined()
  })

  it('returns undefined for non-bolt11 string', () => {
    expect(extractBolt11AmountSats('notaninvoice')).toBeUndefined()
  })

  it('handles testnet invoices (lntb)', () => {
    expect(extractBolt11AmountSats('lntb500u1abc')).toBe(50_000)
  })

  it('handles signet invoices (lntbs)', () => {
    expect(extractBolt11AmountSats('lntbs100n1abc')).toBe(10)
  })

  it('rounds sub-satoshi amounts correctly', () => {
    // lnbc1p = 1 * 0.1 msats / 1000 = 0.0001 sats → rounds to 0
    expect(extractBolt11AmountSats('lnbc1p1abc')).toBe(0)
    // lnbc5000p = 5000 * 0.1 / 1000 = 0.5 → rounds to 1
    expect(extractBolt11AmountSats('lnbc5000p1abc')).toBe(1)
  })
})

// --- handleMarketplaceCompare ---

describe('handleMarketplaceCompare', () => {
  function makeService(overrides: Partial<ParsedService> = {}): ParsedService {
    return {
      id: 'a'.repeat(64),
      identifier: 'svc-1',
      name: 'Service Alpha',
      urls: ['https://alpha.example.com'],
      about: 'Alpha service',
      pubkey: 'b'.repeat(64),
      paymentMethods: [['l402']],
      pricing: [{ capability: 'query', amount: '100', currency: 'sats' }],
      topics: ['ai'],
      capabilities: [
        { name: 'query', description: 'Run queries' },
        { name: 'summarise', description: 'Summarise data' },
      ],
      createdAt: 1700000000,
      ...overrides,
    }
  }

  it('throws when fewer than 2 services provided', () => {
    expect(() => handleMarketplaceCompare([makeService()])).toThrow('At least two services')
    expect(() => handleMarketplaceCompare([])).toThrow('At least two services')
  })

  it('compares two services and finds shared capabilities', () => {
    const alpha = makeService({
      name: 'Alpha',
      capabilities: [
        { name: 'query', description: 'Run queries' },
        { name: 'summarise', description: 'Summarise data' },
      ],
    })
    const beta = makeService({
      name: 'Beta',
      identifier: 'svc-2',
      capabilities: [
        { name: 'query', description: 'Search' },
        { name: 'translate', description: 'Translate text' },
      ],
    })

    const result = handleMarketplaceCompare([alpha, beta])
    expect(result.services).toHaveLength(2)
    expect(result.comparison.sharedCapabilities).toEqual(['query'])
  })

  it('identifies the cheapest service', () => {
    const cheap = makeService({
      name: 'Cheap',
      pricing: [{ capability: 'query', amount: '10', currency: 'sats' }],
    })
    const expensive = makeService({
      name: 'Expensive',
      pricing: [{ capability: 'query', amount: '500', currency: 'sats' }],
    })

    const result = handleMarketplaceCompare([cheap, expensive])
    expect(result.comparison.cheapest).toBe('Cheap')
  })

  it('identifies service with most capabilities', () => {
    const few = makeService({
      name: 'Few',
      capabilities: [{ name: 'one', description: 'One' }],
    })
    const many = makeService({
      name: 'Many',
      capabilities: [
        { name: 'one', description: 'One' },
        { name: 'two', description: 'Two' },
        { name: 'three', description: 'Three' },
      ],
    })

    const result = handleMarketplaceCompare([few, many])
    expect(result.comparison.mostCapabilities).toBe('Many')
  })

  it('handles services with no pricing in sats', () => {
    const usdOnly = makeService({
      name: 'USD Only',
      pricing: [{ capability: 'query', amount: '1.50', currency: 'USD' }],
    })
    const eurOnly = makeService({
      name: 'EUR Only',
      pricing: [{ capability: 'query', amount: '1.20', currency: 'EUR' }],
    })

    const result = handleMarketplaceCompare([usdOnly, eurOnly])
    expect(result.comparison.cheapest).toBeUndefined()
  })

  it('handles services with no capabilities', () => {
    const a = makeService({ name: 'A', capabilities: [] })
    const b = makeService({ name: 'B', capabilities: [] })

    const result = handleMarketplaceCompare([a, b])
    expect(result.comparison.sharedCapabilities).toEqual([])
    expect(result.comparison.mostCapabilities).toBeUndefined()
  })

  it('compares three services', () => {
    const a = makeService({
      name: 'A',
      capabilities: [
        { name: 'shared', description: 'Shared' },
        { name: 'a-only', description: 'A' },
      ],
    })
    const b = makeService({
      name: 'B',
      capabilities: [
        { name: 'shared', description: 'Shared' },
        { name: 'b-only', description: 'B' },
      ],
    })
    const c = makeService({
      name: 'C',
      capabilities: [
        { name: 'shared', description: 'Shared' },
        { name: 'c-only', description: 'C' },
      ],
    })

    const result = handleMarketplaceCompare([a, b, c])
    expect(result.services).toHaveLength(3)
    expect(result.comparison.sharedCapabilities).toEqual(['shared'])
  })
})

// --- Credential store ---

describe('credential store', () => {
  afterEach(() => {
    clearCredentials()
  })

  it('stores and retrieves a credential', () => {
    storeCredential('cred-1', 'macaroon-data', 'preimage-hex')
    const cred = getCredential('cred-1')
    expect(cred).toEqual({ macaroon: 'macaroon-data', preimage: 'preimage-hex' })
  })

  it('returns undefined for unknown credential', () => {
    expect(getCredential('nonexistent')).toBeUndefined()
  })

  it('overwrites existing credential', () => {
    storeCredential('cred-1', 'old-mac', 'old-pre')
    storeCredential('cred-1', 'new-mac', 'new-pre')
    expect(getCredential('cred-1')).toEqual({ macaroon: 'new-mac', preimage: 'new-pre' })
  })

  it('clears all credentials', () => {
    storeCredential('cred-1', 'mac1', 'pre1')
    storeCredential('cred-2', 'mac2', 'pre2')
    clearCredentials()
    expect(getCredential('cred-1')).toBeUndefined()
    expect(getCredential('cred-2')).toBeUndefined()
  })
})

// --- buildL402AuthHeader ---

describe('buildL402AuthHeader', () => {
  afterEach(() => {
    clearCredentials()
  })

  it('builds correct L402 authorization header', () => {
    storeCredential('cred-1', 'AGIEbHNhdA==', 'deadbeef')
    const header = buildL402AuthHeader('cred-1')
    expect(header).toBe('L402 AGIEbHNhdA==:deadbeef')
  })

  it('returns null for unknown credential', () => {
    expect(buildL402AuthHeader('nonexistent')).toBeNull()
  })
})

// --- Async handler tests ---

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    queryDirect: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, allAccepted: true, accepted: ['wss://relay.test'], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: [], write: ['wss://relay.test'] }),
  }
}

function makeAnnounceEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: L402_ANNOUNCE_KIND,
    created_at: 1700000000,
    tags: [
      ['d', 'svc-1'],
      ['name', 'Test Service'],
      ['url', 'https://api.example.com'],
      ['about', 'A test service'],
      ['pmi', 'l402', 'https://api.example.com'],
      ['price', 'query', '100', 'sats'],
      ['t', 'ai'],
    ],
    content: JSON.stringify({
      capabilities: [{ name: 'query', description: 'Run queries' }],
      version: '1.0.0',
    }),
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

// --- handleMarketplaceDiscover ---

describe('handleMarketplaceDiscover', () => {
  it('returns parsed services from relay query', async () => {
    const pool = mockPool([makeAnnounceEvent()])
    const results = await handleMarketplaceDiscover(pool as any, 'npub1test', {})

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Test Service')
    expect(results[0].identifier).toBe('svc-1')
  })

  it('deduplicates replaceable events by pubkey + d-tag', async () => {
    const old = makeAnnounceEvent({ created_at: 1000 })
    const newer = makeAnnounceEvent({ created_at: 2000 })
    const pool = mockPool([old, newer])

    const results = await handleMarketplaceDiscover(pool as any, 'npub1test', {})
    expect(results).toHaveLength(1)
    expect(results[0].createdAt).toBe(2000)
  })

  it('filters by max price and currency', async () => {
    const cheap = makeAnnounceEvent({
      id: '1'.repeat(64),
      tags: [
        ['d', 'cheap'], ['name', 'Cheap'], ['url', 'https://a.com'], ['about', 'A'],
        ['pmi', 'l402'], ['price', 'query', '50', 'sats'],
      ],
    })
    const expensive = makeAnnounceEvent({
      id: '2'.repeat(64),
      pubkey: 'c'.repeat(64),
      tags: [
        ['d', 'expensive'], ['name', 'Expensive'], ['url', 'https://b.com'], ['about', 'B'],
        ['pmi', 'l402'], ['price', 'query', '500', 'sats'],
      ],
    })
    const pool = mockPool([cheap, expensive])

    const results = await handleMarketplaceDiscover(pool as any, 'npub1test', {
      maxPrice: 100,
      currency: 'sats',
    })

    expect(results).toHaveLength(1)
    expect(results[0].identifier).toBe('cheap')
  })

  it('passes topic filters to relay query', async () => {
    const pool = mockPool([])
    await handleMarketplaceDiscover(pool as any, 'npub1test', { topics: ['ai', 'search'] })

    expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
      '#t': ['ai', 'search'],
    }))
  })

  it('passes payment method filter to relay query', async () => {
    const pool = mockPool([])
    await handleMarketplaceDiscover(pool as any, 'npub1test', { paymentMethod: 'l402' })

    expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
      '#pmi': ['l402'],
    }))
  })

  it('uses queryDirect when relays specified', async () => {
    const pool = mockPool([])
    await handleMarketplaceDiscover(pool as any, 'npub1test', { relays: ['wss://custom.relay'] })

    expect(pool.queryDirect).toHaveBeenCalledWith(['wss://custom.relay'], expect.any(Object))
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('returns empty array when no events found', async () => {
    const pool = mockPool([])
    const results = await handleMarketplaceDiscover(pool as any, 'npub1test', {})
    expect(results).toEqual([])
  })
})

// --- handleMarketplaceInspect ---

describe('handleMarketplaceInspect', () => {
  it('fetches by event ID', async () => {
    const pool = mockPool([makeAnnounceEvent()])
    const result = await handleMarketplaceInspect(pool as any, 'npub1test', {
      eventId: 'a'.repeat(64),
    })

    expect(result).not.toBeNull()
    expect(result!.name).toBe('Test Service')
    expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
      ids: ['a'.repeat(64)],
    }))
  })

  it('fetches by pubkey + identifier', async () => {
    const pool = mockPool([makeAnnounceEvent()])
    const result = await handleMarketplaceInspect(pool as any, 'npub1test', {
      pubkey: 'b'.repeat(64),
      identifier: 'svc-1',
    })

    expect(result).not.toBeNull()
    expect(pool.query).toHaveBeenCalledWith('npub1test', expect.objectContaining({
      authors: ['b'.repeat(64)],
      '#d': ['svc-1'],
    }))
  })

  it('returns null when not found', async () => {
    const pool = mockPool([])
    const result = await handleMarketplaceInspect(pool as any, 'npub1test', {
      eventId: 'x'.repeat(64),
    })
    expect(result).toBeNull()
  })

  it('throws when neither eventId nor pubkey+identifier provided', async () => {
    const pool = mockPool([])
    await expect(
      handleMarketplaceInspect(pool as any, 'npub1test', {}),
    ).rejects.toThrow('Provide either eventId, or both pubkey and identifier')
  })

  it('returns newest event when multiple match', async () => {
    const old = makeAnnounceEvent({ created_at: 1000 })
    const newer = makeAnnounceEvent({ created_at: 2000 })
    const pool = mockPool([old, newer])

    const result = await handleMarketplaceInspect(pool as any, 'npub1test', {
      pubkey: 'b'.repeat(64),
      identifier: 'svc-1',
    })

    expect(result!.createdAt).toBe(2000)
  })
})

// --- handleMarketplaceSearch ---

describe('handleMarketplaceSearch', () => {
  it('filters by text match in name', async () => {
    const matching = makeAnnounceEvent({
      id: '1'.repeat(64),
      tags: [
        ['d', 'ai-search'], ['name', 'AI Search Engine'], ['url', 'https://a.com'],
        ['about', 'Search stuff'], ['pmi', 'l402'], ['price', 'q', '10', 'sats'],
      ],
    })
    const notMatching = makeAnnounceEvent({
      id: '2'.repeat(64),
      pubkey: 'c'.repeat(64),
      tags: [
        ['d', 'weather'], ['name', 'Weather API'], ['url', 'https://b.com'],
        ['about', 'Weather data'], ['pmi', 'l402'], ['price', 'q', '10', 'sats'],
      ],
    })
    const pool = mockPool([matching, notMatching])

    const results = await handleMarketplaceSearch(pool as any, 'npub1test', { query: 'search' })
    expect(results).toHaveLength(1)
    expect(results[0].identifier).toBe('ai-search')
  })

  it('matches against about field', async () => {
    const event = makeAnnounceEvent({
      tags: [
        ['d', 'svc'], ['name', 'Generic'], ['url', 'https://a.com'],
        ['about', 'Powerful translation engine'], ['pmi', 'l402'], ['price', 'q', '10', 'sats'],
      ],
    })
    const pool = mockPool([event])

    const results = await handleMarketplaceSearch(pool as any, 'npub1test', { query: 'translation' })
    expect(results).toHaveLength(1)
  })

  it('matches against capability names', async () => {
    const event = makeAnnounceEvent()
    const pool = mockPool([event])

    // The default event has capability { name: 'query', description: 'Run queries' }
    const results = await handleMarketplaceSearch(pool as any, 'npub1test', { query: 'query' })
    expect(results).toHaveLength(1)
  })

  it('is case-insensitive', async () => {
    const event = makeAnnounceEvent()
    const pool = mockPool([event])

    const results = await handleMarketplaceSearch(pool as any, 'npub1test', { query: 'TEST SERVICE' })
    expect(results).toHaveLength(1)
  })

  it('respects limit parameter', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeAnnounceEvent({
      id: String(i).repeat(64),
      pubkey: String(i).repeat(64),
      tags: [
        ['d', `svc-${i}`], ['name', 'Match Service'], ['url', 'https://a.com'],
        ['about', 'Match'], ['pmi', 'l402'], ['price', 'q', '10', 'sats'],
      ],
    }))
    const pool = mockPool(events)

    const results = await handleMarketplaceSearch(pool as any, 'npub1test', { query: 'match', limit: 2 })
    expect(results).toHaveLength(2)
  })
})

// --- handleMarketplaceReputation ---

describe('handleMarketplaceReputation', () => {
  it('returns service count and topic aggregation', async () => {
    const events = [
      makeAnnounceEvent({ tags: [['d', 'svc-1'], ['t', 'ai'], ['t', 'search']] }),
      makeAnnounceEvent({
        id: 'x'.repeat(64),
        tags: [['d', 'svc-2'], ['t', 'ai'], ['t', 'translation']],
        created_at: 1700001000,
      }),
    ]
    const pool = mockPool(events)

    const result = await handleMarketplaceReputation(pool as any, 'npub1test', {
      pubkey: 'b'.repeat(64),
    })

    expect(result.pubkey).toBe('b'.repeat(64))
    expect(result.serviceCount).toBe(2)
    expect(result.topics).toContain('ai')
    expect(result.topics).toContain('search')
    expect(result.topics).toContain('translation')
  })

  it('deduplicates by pubkey + d-tag', async () => {
    const old = makeAnnounceEvent({ created_at: 1000 })
    const newer = makeAnnounceEvent({ created_at: 2000 })
    const pool = mockPool([old, newer])

    const result = await handleMarketplaceReputation(pool as any, 'npub1test', {
      pubkey: 'b'.repeat(64),
    })

    expect(result.serviceCount).toBe(1)
    expect(result.newestAnnouncement).toBe(2000)
  })

  it('returns empty state for unknown pubkey', async () => {
    const pool = mockPool([])
    const result = await handleMarketplaceReputation(pool as any, 'npub1test', {
      pubkey: 'z'.repeat(64),
    })

    expect(result.serviceCount).toBe(0)
    expect(result.oldestAnnouncement).toBeUndefined()
    expect(result.newestAnnouncement).toBeUndefined()
    expect(result.topics).toEqual([])
  })
})

// --- handleMarketplaceProbe ---

describe('handleMarketplaceProbe', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns status and parsed challenge for 402 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 402,
      headers: new Headers({
        'www-authenticate': 'L402 macaroon="AgEEbHNhdA==", invoice="lnbc100n1abc123"',
      }),
      text: vi.fn().mockResolvedValue('{}'),
    }))

    const result = await handleMarketplaceProbe('https://api.example.com/resource')

    expect(result.status).toBe(402)
    expect(result.challenge).toBeDefined()
    expect(result.challenge!.macaroon).toBe('AgEEbHNhdA==')
    expect(result.challenge!.invoice).toBe('lnbc100n1abc123')
    expect(result.costSats).toBe(10)
  })

  it('returns status without challenge for non-402 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('{"ok": true}'),
    }))

    const result = await handleMarketplaceProbe('https://api.example.com/open')

    expect(result.status).toBe(200)
    expect(result.challenge).toBeUndefined()
    expect(result.body).toEqual({ ok: true })
  })

  it('rejects private network URLs', async () => {
    await expect(
      handleMarketplaceProbe('http://localhost:8080/internal'),
    ).rejects.toThrow('private network')
  })

  it('handles non-JSON response body gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('plain text response'),
    }))

    const result = await handleMarketplaceProbe('https://api.example.com/text')
    // Non-JSON text should not throw, body may be undefined or the text
    expect(result.status).toBe(200)
  })
})

// --- handleMarketplaceCall ---

describe('handleMarketplaceCall', () => {
  afterEach(() => {
    clearCredentials()
    vi.restoreAllMocks()
  })

  it('makes authenticated call with L402 header', async () => {
    storeCredential('cred-1', 'AgEEbHNhdA==', 'deadbeef')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: vi.fn().mockResolvedValue('{"result": "success"}'),
    }))

    const result = await handleMarketplaceCall({
      url: 'https://api.example.com/query',
      credentialId: 'cred-1',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ result: 'success' })

    const fetchCall = (fetch as any).mock.calls[0]
    expect(fetchCall[1].headers.Authorization).toBe('L402 AgEEbHNhdA==:deadbeef')
  })

  it('throws when credential not found', async () => {
    await expect(
      handleMarketplaceCall({
        url: 'https://api.example.com/query',
        credentialId: 'nonexistent',
      }),
    ).rejects.toThrow('No credentials found')
  })

  it('rejects private network URLs', async () => {
    storeCredential('cred-1', 'mac', 'pre')

    await expect(
      handleMarketplaceCall({
        url: 'http://127.0.0.1:8080/internal',
        credentialId: 'cred-1',
      }),
    ).rejects.toThrow('private network')
  })

  it('strips set-cookie headers from response', async () => {
    storeCredential('cred-1', 'mac', 'pre')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'set-cookie': 'session=abc123',
        'x-custom': 'kept',
      }),
      text: vi.fn().mockResolvedValue('{}'),
    }))

    const result = await handleMarketplaceCall({
      url: 'https://api.example.com/query',
      credentialId: 'cred-1',
    })

    expect(result.headers['x-custom']).toBe('kept')
    expect(result.headers['set-cookie']).toBeUndefined()
  })
})

// --- handleMarketplaceAnnounce ---

describe('handleMarketplaceAnnounce', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('publishes a valid announcement event', async () => {
    const pool = mockPool()
    const result = await handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'my-api',
      name: 'My API',
      urls: ['https://api.example.com'],
      about: 'A useful API service',
      pricing: [{ capability: 'query', price: 100, currency: 'sats' }],
      paymentMethods: [['l402', 'https://api.example.com']],
    })

    expect(result.event.kind).toBe(L402_ANNOUNCE_KIND)

    const dTag = result.event.tags.find((t: string[]) => t[0] === 'd')
    expect(dTag).toEqual(['d', 'my-api'])

    const nameTag = result.event.tags.find((t: string[]) => t[0] === 'name')
    expect(nameTag).toEqual(['name', 'My API'])

    expect(pool.publish).toHaveBeenCalledOnce()
  })

  it('includes optional fields when provided', async () => {
    const pool = mockPool()
    const result = await handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'full',
      name: 'Full Service',
      urls: ['https://api.example.com'],
      about: 'Full featured',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
      picture: 'https://example.com/logo.png',
      topics: ['ai', 'search'],
      capabilities: [{ name: 'query', description: 'Search' }],
      version: '2.0.0',
    })

    const picTag = result.event.tags.find((t: string[]) => t[0] === 'picture')
    expect(picTag).toEqual(['picture', 'https://example.com/logo.png'])

    const tTags = result.event.tags.filter((t: string[]) => t[0] === 't')
    expect(tTags).toEqual([['t', 'ai'], ['t', 'search']])

    const content = JSON.parse(result.event.content)
    expect(content.capabilities[0].name).toBe('query')
    expect(content.version).toBe('2.0.0')
  })

  // --- Validation tests ---

  it('rejects empty identifier', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: '',
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('identifier must not be empty')
  })

  it('rejects identifier exceeding 256 chars', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'x'.repeat(257),
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('identifier must not exceed 256')
  })

  it('rejects empty name', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: '',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('name must not be empty')
  })

  it('rejects empty URL list', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: [],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('At least one URL')
  })

  it('rejects more than 10 URLs', async () => {
    const pool = mockPool()
    const urls = Array.from({ length: 11 }, (_, i) => `https://api${i}.example.com`)
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls,
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('Maximum 10 URLs')
  })

  it('rejects empty about', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: ['https://a.com'],
      about: '',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('about must not be empty')
  })

  it('rejects empty pricing list', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [],
      paymentMethods: [['l402']],
    })).rejects.toThrow('At least one pricing entry')
  })

  it('rejects negative price', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: -1, currency: 'sats' }],
      paymentMethods: [['l402']],
    })).rejects.toThrow('finite non-negative')
  })

  it('rejects empty payment methods', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [],
    })).rejects.toThrow('At least one payment method')
  })

  it('rejects invalid payment method rail', async () => {
    const pool = mockPool()
    await expect(handleMarketplaceAnnounce(ctx, pool as any, {
      identifier: 'test',
      name: 'Test',
      urls: ['https://a.com'],
      about: 'Test',
      pricing: [{ capability: 'q', price: 10, currency: 'sats' }],
      paymentMethods: [['invalid-rail']],
    })).rejects.toThrow('Payment method rail must be one of')
  })
})

// --- handleMarketplaceRetire ---

describe('handleMarketplaceRetire', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('publishes a kind 5 deletion event with correct a-tag', async () => {
    const pool = mockPool()
    const result = await handleMarketplaceRetire(ctx, pool as any, {
      identifier: 'old-service',
    })

    expect(result.event.kind).toBe(5)

    const aTag = result.event.tags.find((t: string[]) => t[0] === 'a')
    expect(aTag?.[1]).toBe(`${L402_ANNOUNCE_KIND}:${ctx.activePublicKeyHex}:old-service`)
    expect(pool.publish).toHaveBeenCalledOnce()
  })

  it('includes reason in content when provided', async () => {
    const pool = mockPool()
    const result = await handleMarketplaceRetire(ctx, pool as any, {
      identifier: 'old-service',
      reason: 'Service discontinued',
    })

    expect(result.event.content).toBe('Service discontinued')
  })

  it('uses empty content when no reason provided', async () => {
    const pool = mockPool()
    const result = await handleMarketplaceRetire(ctx, pool as any, {
      identifier: 'old-service',
    })

    expect(result.event.content).toBe('')
  })

  it('rejects empty identifier', async () => {
    const pool = mockPool()
    await expect(
      handleMarketplaceRetire(ctx, pool as any, { identifier: '' }),
    ).rejects.toThrow('identifier must not be empty')
  })
})
