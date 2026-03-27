import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseAnnounceEvent,
  parseL402ChallengeHeader,
  extractBolt11AmountSats,
  handleMarketplaceCompare,
  storeCredential,
  getCredential,
  clearCredentials,
  buildL402AuthHeader,
  L402_ANNOUNCE_KIND,
} from '../../src/marketplace/handlers.js'
import type { ParsedService } from '../../src/marketplace/handlers.js'

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
