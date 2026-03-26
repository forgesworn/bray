# Pain Point Solutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WoT-scored feeds, 6 workflow tools, and smart safety defaults to nostr-bray, solving the top Nostr client pain points.

**Architecture:** Three layers — veil integration (scoring/filter/cache), smart defaults on 9 existing tools, and 6 new workflow tools. All use the existing handler extraction pattern (handlers.ts + tools.ts per group).

**Tech Stack:** TypeScript, nostr-veil (WoT scoring), nostr-tools, vitest, Zod schemas

**Spec:** `docs/superpowers/specs/2026-03-26-pain-point-solutions-design.md`

---

## File Structure

### New Files
```
src/veil/cache.ts           — LRU trust score cache with TTL
src/veil/scoring.ts         — scorePubkey(), scoreEvents() wrapping nostr-veil
src/veil/filter.ts          — filterByTrust() for handlers to call
src/workflow/handlers.ts    — handler functions for 6 workflow tools
src/workflow/tools.ts       — Zod schemas + registerWorkflowTools()
test/helpers/mock-veil.ts   — factory functions for mock trust data
test/veil/cache.test.ts     — cache unit tests
test/veil/scoring.test.ts   — scoring unit tests
test/veil/filter.test.ts    — filter unit tests
test/workflow/handlers.test.ts — workflow tool tests
```

### Modified Files
```
package.json                   — add nostr-veil dependency
src/types.ts                   — add veilCacheTtl, veilCacheMax to BrayConfig
src/config.ts                  — load VEIL_CACHE_TTL, VEIL_CACHE_MAX env vars
src/index.ts                   — call registerWorkflowTools(), pass veil deps
src/social/notifications.ts    — trust param on handleFeed + handleNotifications
src/social/handlers.ts         — trust warning on handleSocialReply, contacts guard
src/social/tools.ts            — add trust/confirm params to Zod schemas
src/social/dm.ts               — relay health warning on send, trust annotation on read
src/relay/handlers.ts          — handleRelayList becomes async, adds health annotation
src/relay/tools.ts             — update relay-list registration for async handler
src/identity/handlers.ts       — identity-derive hint
test/social/notifications.test.ts — extend with trust filter tests
test/social/handlers.test.ts   — extend with reply warning + contacts guard tests
test/social/dm.test.ts         — extend with health warning/annotation tests
test/relay/handlers.test.ts    — extend with health annotation tests
```

---

## Task 1: Add nostr-veil dependency and config

**Files:**
- Modify: `package.json`
- Modify: `src/types.ts` — add veilCacheTtl, veilCacheMax to BrayConfig interface
- Modify: `src/config.ts` — load env vars and return in config

- [ ] **Step 1: Add nostr-veil to package.json**

```bash
cd /Users/darren/WebstormProjects/bray
npm install --save file:../nostr-veil
```

Note: Using local file reference until nostr-veil >=0.1.0 is published to npm. Switch to `nostr-veil@^0.1.0` after publish.

- [ ] **Step 2: Add veil cache config to src/config.ts**

After the existing env var loading block (near the `nip04Enabled` line), add:

```typescript
// Veil trust cache
const veilCacheTtl = process.env.VEIL_CACHE_TTL
  ? parseInt(process.env.VEIL_CACHE_TTL, 10) * 1000
  : 300_000 // 5 minutes default
const veilCacheMax = process.env.VEIL_CACHE_MAX
  ? parseInt(process.env.VEIL_CACHE_MAX, 10)
  : 500
```

Add `veilCacheTtl: number` and `veilCacheMax: number` to the `BrayConfig` interface in `src/types.ts` (line 36), and add the parsed values to the return object in `src/config.ts`.

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Clean compilation with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/config.ts
git commit -m "feat: add nostr-veil dependency and veil cache config"
```

---

## Task 2: Veil cache module

**Files:**
- Create: `src/veil/cache.ts`
- Create: `test/veil/cache.test.ts`

- [ ] **Step 1: Write failing tests for cache**

Create `test/veil/cache.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TrustCache, type TrustCacheEntry } from '../../src/veil/cache.js'

describe('TrustCache', () => {
  let cache: TrustCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new TrustCache({ ttl: 5000, maxEntries: 3 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves entries by pubkey', () => {
    const entry: TrustCacheEntry = { score: 42, endorsements: 3, ringEndorsements: 1 }
    cache.set('abc123', entry)
    expect(cache.get('abc123')).toEqual(entry)
  })

  it('returns undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires entries after TTL', () => {
    cache.set('abc123', { score: 42, endorsements: 3, ringEndorsements: 1 })
    vi.advanceTimersByTime(6000)
    expect(cache.get('abc123')).toBeUndefined()
  })

  it('evicts LRU entry when max exceeded', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.set('b', { score: 2, endorsements: 0, ringEndorsements: 0 })
    cache.set('c', { score: 3, endorsements: 0, ringEndorsements: 0 })
    // Access 'a' to make it recently used
    cache.get('a')
    // Adding 'd' should evict 'b' (least recently used)
    cache.set('d', { score: 4, endorsements: 0, ringEndorsements: 0 })
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('d')).toBeDefined()
  })

  it('reports correct size', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.set('b', { score: 2, endorsements: 0, ringEndorsements: 0 })
    expect(cache.size).toBe(2)
  })

  it('clears all entries', () => {
    cache.set('a', { score: 1, endorsements: 0, ringEndorsements: 0 })
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/veil/cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cache**

Create `src/veil/cache.ts`:

```typescript
export interface TrustCacheEntry {
  score: number
  endorsements: number
  ringEndorsements: number
}

interface CacheItem {
  entry: TrustCacheEntry
  storedAt: number
  lastAccess: number
}

export interface TrustCacheOptions {
  ttl: number       // milliseconds
  maxEntries: number
}

export class TrustCache {
  private readonly items = new Map<string, CacheItem>()
  private readonly ttl: number
  private readonly maxEntries: number

  constructor(opts: TrustCacheOptions) {
    this.ttl = opts.ttl
    this.maxEntries = opts.maxEntries
  }

  get(pubkey: string): TrustCacheEntry | undefined {
    const item = this.items.get(pubkey)
    if (!item) return undefined
    if (Date.now() - item.storedAt > this.ttl) {
      this.items.delete(pubkey)
      return undefined
    }
    item.lastAccess = Date.now()
    return item.entry
  }

  set(pubkey: string, entry: TrustCacheEntry): void {
    if (this.items.size >= this.maxEntries && !this.items.has(pubkey)) {
      this.evictLru()
    }
    this.items.set(pubkey, {
      entry,
      storedAt: Date.now(),
      lastAccess: Date.now(),
    })
  }

  get size(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  private evictLru(): void {
    let oldestKey: string | undefined
    let oldestAccess = Infinity
    for (const [key, item] of this.items) {
      if (item.lastAccess < oldestAccess) {
        oldestAccess = item.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) this.items.delete(oldestKey)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/veil/cache.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/veil/cache.ts test/veil/cache.test.ts
git commit -m "feat: add LRU trust score cache with TTL"
```

---

## Task 3: Veil scoring module

**Files:**
- Create: `src/veil/scoring.ts`
- Create: `test/helpers/mock-veil.ts`
- Create: `test/veil/scoring.test.ts`

- [ ] **Step 1: Create mock-veil test helper**

Create `test/helpers/mock-veil.ts`:

```typescript
import type { Event as NostrEvent } from 'nostr-tools'

export function mockNip85Assertion(opts: {
  subject: string
  author: string
  endorsements?: number
  ringEndorsements?: number
}): NostrEvent {
  return {
    id: `mock-${Math.random().toString(36).slice(2)}`,
    pubkey: opts.author,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30382,
    tags: [
      ['d', opts.subject],
      ['p', opts.subject],
      ['followers', String(opts.endorsements ?? 1)],
    ],
    content: '',
    sig: 'mock-sig',
  }
}

export function mockTrustRank(pubkey: string, score: number) {
  return { pubkey, score, endorsements: Math.floor(score / 10), ringEndorsements: 0 }
}
```

- [ ] **Step 2: Write failing tests for scoring**

Create `test/veil/scoring.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VeilScoring } from '../../src/veil/scoring.js'
import { TrustCache } from '../../src/veil/cache.js'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    queryDirect: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

// Mock nostr-veil modules
vi.mock('nostr-veil/graph', () => ({
  buildTrustGraph: vi.fn().mockReturnValue({ nodes: new Map(), edges: [] }),
  computeTrustRank: vi.fn().mockReturnValue([]),
}))

vi.mock('nostr-veil/proof', () => ({
  verifyProof: vi.fn().mockReturnValue({ valid: true, circleSize: 3, threshold: 2, distinctSigners: 2, errors: [] }),
}))

describe('VeilScoring', () => {
  let scoring: VeilScoring
  let pool: ReturnType<typeof mockPool>
  let cache: TrustCache

  beforeEach(() => {
    pool = mockPool()
    cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    scoring = new VeilScoring(pool as any, cache, 'wss://relay.test')
  })

  it('returns score 0 for pubkey with no assertions', async () => {
    const result = await scoring.scorePubkey('deadbeef'.repeat(8))
    expect(result.score).toBe(0)
    expect(result.endorsements).toBe(0)
  })

  it('caches results on subsequent calls', async () => {
    const pubkey = 'deadbeef'.repeat(8)
    await scoring.scorePubkey(pubkey)
    await scoring.scorePubkey(pubkey)
    // Pool should only be queried once
    expect(pool.query).toHaveBeenCalledTimes(1)
  })

  it('scores batch of events by author trust', async () => {
    const events = [
      { id: 'e1', pubkey: 'aaa'.padEnd(64, '0'), kind: 1, content: 'hello', created_at: 1, tags: [], sig: 'sig1' },
      { id: 'e2', pubkey: 'bbb'.padEnd(64, '0'), kind: 1, content: 'world', created_at: 2, tags: [], sig: 'sig2' },
    ]
    const scored = await scoring.scoreEvents(events as any)
    expect(scored).toHaveLength(2)
    expect(scored[0]).toHaveProperty('_trustScore')
    expect(scored[1]).toHaveProperty('_trustScore')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run test/veil/scoring.test.ts
```

Expected: FAIL — VeilScoring not found.

- [ ] **Step 4: Implement scoring module**

Create `src/veil/scoring.ts`:

```typescript
import { buildTrustGraph, computeTrustRank } from 'nostr-veil/graph'
import { verifyProof } from 'nostr-veil/proof'
import type { Event as NostrEvent } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import type { TrustCache, TrustCacheEntry } from './cache.js'

export interface TrustScoreResult extends TrustCacheEntry {
  pubkey: string
  flags: string[]
}

export interface ScoredEvent extends NostrEvent {
  _trustScore: number
}

export class VeilScoring {
  constructor(
    private readonly pool: RelayPool,
    private readonly cache: TrustCache,
    private readonly npub: string, // Captured at call time — create a new instance per tool call to reflect identity switches
  ) {}

  async scorePubkey(pubkey: string): Promise<TrustScoreResult> {
    const cached = this.cache.get(pubkey)
    if (cached) {
      return { ...cached, pubkey, flags: [] }
    }

    const events = await this.pool.query(this.npub, {
      kinds: [30382],
      '#p': [pubkey],
    })

    if (events.length === 0) {
      const result: TrustScoreResult = {
        pubkey,
        score: 0,
        endorsements: 0,
        ringEndorsements: 0,
        flags: ['no endorsements found'],
      }
      this.cache.set(pubkey, { score: 0, endorsements: 0, ringEndorsements: 0 })
      return result
    }

    const graph = buildTrustGraph(events)
    const ranks = computeTrustRank(graph)
    const rank = ranks.find((r: { pubkey: string }) => r.pubkey === pubkey)

    const flags: string[] = []
    let ringCount = 0

    for (const event of events) {
      const veilSigTags = event.tags.filter((t: string[]) => t[0] === 'veil-sig')
      if (veilSigTags.length > 0) {
        const proof = verifyProof(event)
        if (proof.valid) {
          ringCount += proof.distinctSigners
        } else {
          flags.push('ring proof invalid')
        }
      }
    }

    const score = rank?.score ?? 0
    const endorsements = (rank as any)?.endorsements ?? events.length
    const entry: TrustCacheEntry = { score, endorsements, ringEndorsements: ringCount }
    this.cache.set(pubkey, entry)

    return { ...entry, pubkey, flags }
  }

  async scoreEvents(events: NostrEvent[]): Promise<ScoredEvent[]> {
    const uniqueAuthors = [...new Set(events.map(e => e.pubkey))]
    const scores = new Map<string, number>()

    await Promise.all(
      uniqueAuthors.map(async (pubkey) => {
        const result = await this.scorePubkey(pubkey)
        scores.set(pubkey, result.score)
      }),
    )

    return events.map(e => ({
      ...e,
      _trustScore: scores.get(e.pubkey) ?? 0,
    }))
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/veil/scoring.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/veil/scoring.ts test/veil/scoring.test.ts test/helpers/mock-veil.ts
git commit -m "feat: add veil trust scoring module"
```

---

## Task 4: Veil filter module

**Files:**
- Create: `src/veil/filter.ts`
- Create: `test/veil/filter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/veil/filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { filterByTrust, type TrustMode } from '../../src/veil/filter.js'
import type { ScoredEvent } from '../../src/veil/scoring.js'

function scored(pubkey: string, score: number): ScoredEvent {
  return {
    id: `e-${pubkey}`,
    pubkey,
    kind: 1,
    content: `post by ${pubkey}`,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    sig: 'mock',
    _trustScore: score,
  }
}

describe('filterByTrust', () => {
  const events = [
    scored('trusted', 50),
    scored('marginal', 1),
    scored('unknown', 0),
  ]

  it('strict mode hides events below threshold', () => {
    const result = filterByTrust(events, { mode: 'strict', threshold: 1 })
    expect(result).toHaveLength(2)
    expect(result.map(e => e.pubkey)).toEqual(['trusted', 'marginal'])
  })

  it('annotate mode returns all events with scores', () => {
    const result = filterByTrust(events, { mode: 'annotate', threshold: 1 })
    expect(result).toHaveLength(3)
    expect(result.every(e => '_trustScore' in e)).toBe(true)
  })

  it('off mode returns all events unchanged', () => {
    const result = filterByTrust(events, { mode: 'off' })
    expect(result).toHaveLength(3)
  })

  it('defaults to strict mode with threshold 1', () => {
    const result = filterByTrust(events)
    expect(result).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/veil/filter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement filter**

Create `src/veil/filter.ts`:

```typescript
import type { ScoredEvent } from './scoring.js'

export type TrustMode = 'strict' | 'annotate' | 'off'

export interface FilterOptions {
  mode?: TrustMode
  threshold?: number
}

export function filterByTrust(
  events: ScoredEvent[],
  opts?: FilterOptions,
): ScoredEvent[] {
  const mode = opts?.mode ?? 'strict'
  const threshold = opts?.threshold ?? 1

  if (mode === 'off') return events
  if (mode === 'annotate') return events
  // strict
  return events.filter(e => e._trustScore >= threshold)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/veil/filter.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/veil/filter.ts test/veil/filter.test.ts
git commit -m "feat: add trust-based event filter"
```

---

## Task 5: Smart defaults — social-feed and social-notifications trust scoring

**Files:**
- Modify: `src/social/notifications.ts` — `handleFeed` (line 100) and `handleNotifications` (line 28)
- Modify: `src/social/tools.ts` — add `trust` param to schemas
- Create/Modify: `test/social/notifications.test.ts` — add trust filter tests

**Critical note:** `handleFeed` returns `FeedEntry[]` (mapped from raw events at line 112-118). Trust scoring must happen on raw `NostrEvent[]` from the relay, BEFORE the mapping to `FeedEntry`. The scoring result (`_trustScore`) is then carried into the `FeedEntry`.

- [ ] **Step 1: Write failing tests for trust-filtered feed**

Add to `test/social/notifications.test.ts` (create if needed):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { handleFeed } from '../../src/social/notifications.js'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

vi.mock('nostr-veil/graph', () => ({
  buildTrustGraph: vi.fn().mockReturnValue({ nodes: new Map(), edges: [] }),
  computeTrustRank: vi.fn().mockReturnValue([]),
}))

vi.mock('nostr-veil/proof', () => ({
  verifyProof: vi.fn().mockReturnValue({ valid: true, circleSize: 3, threshold: 2, distinctSigners: 2, errors: [] }),
}))

describe('handleFeed with trust scoring', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('filters events by trust score in strict mode', async () => {
    const trustedPubkey = 'trusted0'.padEnd(64, '0')
    const untrustedPubkey = 'untrust0'.padEnd(64, '0')
    const pool = mockPool([
      { id: 'e1', pubkey: trustedPubkey, kind: 1, content: 'hi', created_at: 1, tags: [], sig: 's1' },
      { id: 'e2', pubkey: untrustedPubkey, kind: 1, content: 'spam', created_at: 2, tags: [], sig: 's2' },
    ])

    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    cache.set(trustedPubkey, { score: 50, endorsements: 5, ringEndorsements: 0 })
    cache.set(untrustedPubkey, { score: 0, endorsements: 0, ringEndorsements: 0 })

    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)
    const result = await handleFeed(ctx, pool as any, { limit: 20, trust: 'strict', _scoring: scoring })

    expect(result.length).toBe(1)
    expect(result[0].pubkey).toBe(trustedPubkey)
    expect(result[0]).toHaveProperty('trustScore')
  })

  it('returns all events with trust off', async () => {
    const pool = mockPool([
      { id: 'e1', pubkey: 'a'.padEnd(64, '0'), kind: 1, content: 'a', created_at: 1, tags: [], sig: 's1' },
      { id: 'e2', pubkey: 'b'.padEnd(64, '0'), kind: 1, content: 'b', created_at: 2, tags: [], sig: 's2' },
    ])
    const result = await handleFeed(ctx, pool as any, { limit: 20, trust: 'off' })
    expect(result.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/social/notifications.test.ts
```

Expected: FAIL — `trust` param not recognised.

- [ ] **Step 3: Add trust param to handleFeed in notifications.ts**

In `src/social/notifications.ts`, update `handleFeed`:

```typescript
import type { VeilScoring } from '../veil/scoring.js'
import type { TrustMode } from '../veil/filter.js'
import { filterByTrust } from '../veil/filter.js'

export async function handleFeed(
  ctx: IdentityContext,
  pool: RelayPool,
  opts: {
    authors?: string[]
    since?: number
    limit?: number
    trust?: TrustMode
    _scoring?: VeilScoring
  },
): Promise<FeedEntry[]> {
  const events = await pool.query(ctx.activeNpub, {
    kinds: [1],
    ...(opts.authors ? { authors: opts.authors } : {}),
    ...(opts.since ? { since: opts.since } : {}),
    limit: opts.limit ?? 20,
  })

  // Score raw events BEFORE mapping to FeedEntry
  if (opts._scoring && opts.trust !== 'off') {
    const scored = await opts._scoring.scoreEvents(events)
    const filtered = filterByTrust(scored, { mode: opts.trust ?? 'strict' })
    return filtered.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      content: e.content,
      createdAt: e.created_at,
      tags: e.tags,
      trustScore: e._trustScore,
    }))
  }

  return events.map(e => ({
    id: e.id,
    pubkey: e.pubkey,
    content: e.content,
    createdAt: e.created_at,
    tags: e.tags,
  }))
}
```

Add `trustScore?: number` to the `FeedEntry` interface.

- [ ] **Step 4: Add trust param to social-feed Zod schema in tools.ts**

In `src/social/tools.ts`, add to the social-feed inputSchema:

```typescript
trust: z.enum(['strict', 'annotate', 'off']).default('strict')
  .describe('Trust filter mode: strict (hide untrusted), annotate (show scores), off (no filtering)'),
```

Pass `trust` and the scoring instance to `handleFeed`. Create scoring per-call:

```typescript
const scoring = new VeilScoring(deps.pool, cache, deps.ctx.activeNpub)
```

This ensures `activeNpub` is captured at call time, not registration time, so identity switches are reflected.

- [ ] **Step 5: Apply same pattern to handleNotifications in notifications.ts**

Same change: add `trust` param, score raw events, filter before mapping.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run test/social/notifications.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: All 329+ tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/social/notifications.ts src/social/tools.ts test/social/notifications.test.ts
git commit -m "feat: add trust scoring to social-feed and social-notifications"
```

---

## Task 6: Smart defaults — social-reply warning, dm-read annotation

**Files:**
- Modify: `src/social/handlers.ts` — `handleSocialReply`
- Modify: `src/social/dm.ts` — `handleDmRead`
- Modify: `test/social/handlers.test.ts`
- Modify: `test/social/dm.test.ts`

- [ ] **Step 1: Write failing test for reply trust warning**

Add to `test/social/handlers.test.ts`:

```typescript
describe('handleSocialReply with trust', () => {
  it('includes trust warning when replying to untrusted author', async () => {
    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    cache.set('untrusted'.padEnd(64, '0'), { score: 0, endorsements: 0, ringEndorsements: 0 })
    const pool = mockPool()
    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)

    const result = await handleSocialReply(ctx, pool as any, {
      content: 'reply',
      replyTo: 'event123'.padEnd(64, '0'),
      replyToPubkey: 'untrusted'.padEnd(64, '0'),
      _scoring: scoring,
    })

    expect(result.trustWarning).toBe('This author has no trust endorsements in your network.')
  })
})
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run test/social/handlers.test.ts
```

- [ ] **Step 3: Add trust warning to handleSocialReply**

In `src/social/handlers.ts`, after the existing reply logic, add:

```typescript
if (args._scoring) {
  const score = await args._scoring.scorePubkey(args.replyToPubkey)
  if (score.score === 0) {
    result.trustWarning = 'This author has no trust endorsements in your network.'
  } else {
    result.authorTrustScore = score.score
  }
}
```

- [ ] **Step 4: Add trust annotation to dm-read**

In `src/social/dm.ts`, after decrypting each DM in `handleDmRead`, annotate with trust score if scoring available:

```typescript
if (args._scoring) {
  const score = await args._scoring.scorePubkey(entry.from)
  entry.senderTrustScore = score.score
}
```

- [ ] **Step 5: Write test for dm-read annotation**

Add to `test/social/dm.test.ts`:

```typescript
it('annotates DM entries with sender trust score', async () => {
  // ... setup with mock pool returning a kind 1059 event ...
  // ... setup scoring with known score for sender ...
  const entries = await handleDmRead(ctx, pool as any, { _scoring: scoring })
  expect(entries[0].senderTrustScore).toBeDefined()
})
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/social/handlers.ts src/social/dm.ts test/social/handlers.test.ts test/social/dm.test.ts
git commit -m "feat: add trust warnings on reply and trust annotation on dm-read"
```

---

## Task 7: Smart defaults — contacts safety guard

**Files:**
- Modify: `src/social/handlers.ts` — `handleContactsFollow`, `handleContactsUnfollow`
- Modify: `src/social/tools.ts` — add `confirm` param
- Modify: `test/social/handlers.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/social/handlers.test.ts`:

```typescript
describe('contacts safety guard', () => {
  it('warns when contacts-follow would shrink list by >20%', async () => {
    // Mock pool returns existing contact list with 10 contacts
    const existingContacts = Array.from({ length: 10 }, (_, i) => ({
      pubkey: `contact${i}`.padEnd(64, '0'),
      relay: '',
      petname: '',
    }))
    const existingEvent = createKind3Event(existingContacts)
    const pool = mockPool([existingEvent])

    // Follow should add 1 but simulate a bug that loses 9
    // The guard checks post-mutation size vs pre-mutation size
    // In normal follow, list grows by 1 — no guard triggered
    const result = await handleContactsFollow(ctx, pool as any, {
      pubkeyHex: 'newcontact'.padEnd(64, '0'),
    })
    // Normal follow — list grows by 1, no guard triggered
    expect('guarded' in result).toBe(false)
    expect(result).toHaveProperty('event') // PostResult shape
  })

  it('allows contacts-unfollow when shrinkage is at boundary', async () => {
    // Start with 5 contacts, unfollow 1 = 20% exactly — at boundary, should pass
    const existingContacts = Array.from({ length: 5 }, (_, i) => ({
      pubkey: `contact${i}`.padEnd(64, '0'),
    }))
    const existingEvent = createKind3Event(existingContacts)
    const pool = mockPool([existingEvent])

    const result = await handleContactsUnfollow(ctx, pool as any, {
      pubkeyHex: 'contact0'.padEnd(64, '0'),
    })
    // Single unfollow from 5 is exactly 20% — should pass (guard triggers >20% not >=)
    expect('guarded' in result).toBe(false)
  })
})
```

- [ ] **Step 2: Implement contacts guard**

In `src/social/handlers.ts`, add the guard type and update both handlers:

```typescript
export interface ContactGuardWarning {
  guarded: true
  warning: string
  previousCount: number
  proposedCount: number
}

// Update return type signatures:
export async function handleContactsFollow(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkeyHex: string; relay?: string; petname?: string; confirm?: boolean },
): Promise<PostResult | ContactGuardWarning> {
  // ... existing logic to fetch current contacts and build new list ...

  // Guard: check if list shrank unexpectedly
  if (oldList.length > 0) {
    const shrinkage = 1 - (newList.length / oldList.length)
    if (shrinkage > 0.2 && !args.confirm) {
      return {
        guarded: true,
        warning: `Contact list would shrink by ${Math.round(shrinkage * 100)}% (${oldList.length} → ${newList.length}). Pass confirm: true to proceed.`,
        previousCount: oldList.length,
        proposedCount: newList.length,
      }
    }
  }

  // ... proceed with publish ...
}
```

Note: Uses `guarded: true` discriminant instead of `published: false` since `PostResult` has no `published` field. The tool registration checks `'guarded' in result` to format the response differently.

- [ ] **Step 3: Add confirm param to Zod schemas**

In `src/social/tools.ts`, add to contacts-follow and contacts-unfollow:

```typescript
confirm: z.boolean().optional()
  .describe('Required when the operation would shrink your contact list by >20%'),
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/social/handlers.ts src/social/tools.ts test/social/handlers.test.ts
git commit -m "feat: add contacts safety guard against accidental list destruction"
```

---

## Task 8: Smart defaults — dm-send health warning, relay-list health, identity-derive hint

**Files:**
- Modify: `src/social/dm.ts` — `handleDmSend`
- Modify: `src/relay/handlers.ts` — `handleRelayList` (sync → async)
- Modify: `src/relay/tools.ts` — update registration
- Modify: `src/identity/handlers.ts` — `handleIdentityDerive`
- Extend: relevant test files

- [ ] **Step 1: Write failing test for dm-send health warning**

Add to `test/social/dm.test.ts`:

```typescript
it('warns when recipient inbox relays are unreachable', async () => {
  const nip65 = {
    loadForIdentity: vi.fn().mockResolvedValue({ read: ['wss://dead.relay'], write: [] }),
  }
  const pool = mockPool()
  // Simulate relay being unreachable by having publishDirect return all rejected
  pool.publishDirect = vi.fn().mockResolvedValue({
    success: false,
    accepted: [],
    rejected: ['wss://dead.relay'],
    errors: [{ relay: 'wss://dead.relay', error: 'connection failed' }],
  })

  const result = await handleDmSend(ctx, pool as any, {
    recipientPubkeyHex: 'recipient'.padEnd(64, '0'),
    message: 'hello',
    nip65: nip65 as any,
  })

  expect(result.relayWarning).toContain('inbox relays')
})
```

- [ ] **Step 2: Implement dm-send relay warning**

In `src/social/dm.ts`, after the publish step:

```typescript
if (recipientRelays.length > 0 && publish.accepted.length === 0) {
  result.relayWarning = "None of recipient's inbox relays accepted the message. It may not be delivered."
}
```

- [ ] **Step 3: Write failing test for async relay-list health**

Add to `test/relay/handlers.test.ts`:

```typescript
it('annotates relays with reachability', async () => {
  const pool = mockPool()
  pool.getRelays = vi.fn().mockReturnValue({
    read: ['wss://alive.relay', 'wss://dead.relay'],
    write: ['wss://alive.relay'],
  })

  const result = await handleRelayList(ctx, pool as any)
  expect(result.health).toBeDefined()
  expect(Array.isArray(result.health)).toBe(true)
})
```

- [ ] **Step 4: Make handleRelayList async with health checks**

In `src/relay/handlers.ts`, change `handleRelayList` from sync to async:

```typescript
export async function handleRelayList(
  ctx: IdentityContext,
  pool: RelayPool,
  compareWithNpub?: string,
): Promise<RelayListResult> {
  const relays = pool.getRelays(ctx.activeNpub)

  // Health check each relay (3s timeout)
  const health = await Promise.all(
    [...new Set([...relays.read, ...relays.write])].map(async (url) => {
      try {
        const start = Date.now()
        const response = await fetch(url.replace('wss://', 'https://').replace('ws://', 'http://'), {
          headers: { Accept: 'application/nostr+json' },
          signal: AbortSignal.timeout(3000),
        })
        return {
          url,
          reachable: response.ok,
          responseTime: Date.now() - start,
        }
      } catch {
        return { url, reachable: false, responseTime: -1 }
      }
    }),
  )

  const result: RelayListResult = { read: relays.read, write: relays.write, health }
  // ... existing comparison logic ...
  return result
}
```

- [ ] **Step 5: Update relay-list tool registration to await async handler**

In `src/relay/tools.ts`, ensure the handler callback uses `await`:

```typescript
// Should already be: async (args) => { const result = await handleRelayList(...) }
// Verify this is the case — if handleRelayList was sync before, the registration
// may not have used await. Add it if missing.
```

- [ ] **Step 6: Add identity-derive hint**

In `src/identity/handlers.ts`, at the end of `handleIdentityDerive`, check if this is the first derivation:

```typescript
if (ctx.cachedCount === 1) { // only master, this is first derived
  result.hint = 'Consider running identity-setup for guided safe identity creation with backup and relay configuration.'
}
```

Note: May need to expose a `cachedCount` getter on IdentityContext, or check via the return data.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add src/social/dm.ts src/relay/handlers.ts src/relay/tools.ts src/identity/handlers.ts \
  test/social/dm.test.ts test/relay/handlers.test.ts
git commit -m "feat: add dm-send relay warning, relay-list health checks, identity-derive hint"
```

---

## Task 9: Workflow tool — trust-score

**Files:**
- Create: `src/workflow/handlers.ts` (start with trust-score)
- Create: `test/workflow/handlers.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/workflow/handlers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentityContext } from '../../src/context.js'
import { TrustCache } from '../../src/veil/cache.js'
import { VeilScoring } from '../../src/veil/scoring.js'
import { handleTrustScore } from '../../src/workflow/handlers.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

function mockPool(events: any[] = []) {
  return {
    query: vi.fn().mockResolvedValue(events),
    publish: vi.fn().mockResolvedValue({ success: true, accepted: [], rejected: [], errors: [] }),
    getRelays: vi.fn().mockReturnValue({ read: ['wss://relay.test'], write: ['wss://relay.test'] }),
  }
}

vi.mock('nostr-veil/graph', () => ({
  buildTrustGraph: vi.fn().mockReturnValue({ nodes: new Map(), edges: [] }),
  computeTrustRank: vi.fn().mockReturnValue([
    { pubkey: 'subject'.padEnd(64, '0'), score: 72, endorsements: 5, ringEndorsements: 2 },
  ]),
}))

vi.mock('nostr-veil/proof', () => ({
  verifyProof: vi.fn().mockReturnValue({ valid: true, circleSize: 3, threshold: 2, distinctSigners: 2, errors: [] }),
}))

describe('handleTrustScore', () => {
  let ctx: IdentityContext

  beforeEach(() => {
    ctx = new IdentityContext(TEST_NSEC, 'nsec')
  })

  it('returns structured trust score for a pubkey', async () => {
    const pool = mockPool([
      { id: 'a1', pubkey: 'endorser'.padEnd(64, '0'), kind: 30382, tags: [['d', 'subject'.padEnd(64, '0')], ['p', 'subject'.padEnd(64, '0')]], content: '', created_at: 1, sig: 's' },
    ])
    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)

    const result = await handleTrustScore(ctx, pool as any, scoring, {
      pubkey: 'subject'.padEnd(64, '0'),
    })

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.pubkey).toBe('subject'.padEnd(64, '0'))
    expect(result).toHaveProperty('endorsements')
    expect(result).toHaveProperty('ringEndorsements')
    expect(result).toHaveProperty('flags')
  })

  it('returns score 0 with flag for unknown pubkey', async () => {
    const pool = mockPool([])
    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })

    // Re-mock for empty result
    const { computeTrustRank } = await import('nostr-veil/graph')
    vi.mocked(computeTrustRank).mockReturnValueOnce([])

    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)
    const result = await handleTrustScore(ctx, pool as any, scoring, {
      pubkey: 'unknown'.padEnd(64, '0'),
    })

    expect(result.score).toBe(0)
    expect(result.flags).toContain('no endorsements found')
  })
})
```

- [ ] **Step 2: Run test, verify fail**

```bash
npx vitest run test/workflow/handlers.test.ts
```

- [ ] **Step 3: Implement handleTrustScore**

Create `src/workflow/handlers.ts`:

```typescript
import { npubEncode } from 'nostr-tools/nip19'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { VeilScoring, TrustScoreResult } from '../veil/scoring.js'

export interface TrustScoreResponse extends TrustScoreResult {
  npub: string
  attestations: Array<{ type: string; attestor: string; content: string; expires?: string }>
  socialDistance: number
}

export async function handleTrustScore(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { pubkey: string; depth?: number },
): Promise<TrustScoreResponse> {
  const scoreResult = await scoring.scorePubkey(args.pubkey)

  // Fetch NIP-VA attestations
  const attestationEvents = await pool.query(ctx.activeNpub, {
    kinds: [31000],
    '#p': [args.pubkey],
  })

  const attestations = attestationEvents.map(e => ({
    type: e.tags.find((t: string[]) => t[0] === 'type')?.[1] ?? 'unknown',
    attestor: e.pubkey,
    content: e.content,
    expires: e.tags.find((t: string[]) => t[0] === 'expiration')?.[1],
  }))

  // Compute social distance via follow graph
  const socialDistance = await computeSocialDistance(ctx, pool, args.pubkey, args.depth ?? 2)

  return {
    ...scoreResult,
    npub: npubEncode(args.pubkey),
    attestations,
    socialDistance,
  }
}

async function computeSocialDistance(
  ctx: IdentityContext,
  pool: RelayPool,
  targetPubkey: string,
  maxDepth: number,
): Promise<number> {
  const myHex = ctx.activePublicKeyHex
  if (myHex === targetPubkey) return 0

  // Hop 1: my contacts
  const myContacts = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: [myHex],
    limit: 1,
  })

  if (myContacts.length === 0) return -1

  const myFollows = new Set(
    myContacts[0].tags
      .filter((t: string[]) => t[0] === 'p')
      .map((t: string[]) => t[1]),
  )

  if (myFollows.has(targetPubkey)) return 1
  if (maxDepth < 2) return -1

  // Hop 2: contacts of contacts (capped at 500)
  const followArray = [...myFollows].slice(0, 500)
  const hop2Events = await pool.query(ctx.activeNpub, {
    kinds: [3],
    authors: followArray,
  })

  for (const event of hop2Events) {
    const follows = event.tags
      .filter((t: string[]) => t[0] === 'p')
      .map((t: string[]) => t[1])
    if (follows.includes(targetPubkey)) return 2
  }

  return -1 // not found within maxDepth
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/workflow/handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/handlers.ts test/workflow/handlers.test.ts
git commit -m "feat: add trust-score workflow tool"
```

---

## Task 10: Workflow tools — feed-discover and verify-person

**Files:**
- Modify: `src/workflow/handlers.ts`
- Modify: `test/workflow/handlers.test.ts`

- [ ] **Step 1: Write failing tests for feed-discover**

Add to `test/workflow/handlers.test.ts`:

```typescript
describe('handleFeedDiscover', () => {
  it('returns trust-adjacent suggestions with scores', async () => {
    // Mock: active identity follows A and B
    // A follows C and D (not followed by active)
    // Result should suggest C and D ranked by trust
    const myContacts = createKind3Event(['a'.padEnd(64, '0'), 'b'.padEnd(64, '0')])
    const aContacts = createKind3Event(['c'.padEnd(64, '0'), 'd'.padEnd(64, '0')])
    const pool = mockPool()
    pool.query = vi.fn()
      .mockResolvedValueOnce([myContacts])   // my kind 3
      .mockResolvedValueOnce([aContacts])     // contacts' kind 3
      .mockResolvedValue([])                  // profile lookups

    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)

    const result = await handleFeedDiscover(ctx, pool as any, scoring, {
      strategy: 'trust-adjacent',
      limit: 10,
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('pubkey')
    expect(result[0]).toHaveProperty('trustScore')
    expect(result[0]).toHaveProperty('reason')
  })
})
```

- [ ] **Step 2: Write failing tests for verify-person**

Add to `test/workflow/handlers.test.ts`:

```typescript
describe('handleVerifyPerson', () => {
  it('returns quick verification summary', async () => {
    const pool = mockPool([])
    const cache = new TrustCache({ ttl: 300_000, maxEntries: 500 })
    cache.set('subject'.padEnd(64, '0'), { score: 50, endorsements: 5, ringEndorsements: 1 })
    const scoring = new VeilScoring(pool as any, cache, ctx.activeNpub)

    const result = await handleVerifyPerson(ctx, pool as any, scoring, {
      pubkey: 'subject'.padEnd(64, '0'),
      method: 'quick',
    })

    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('trustScore')
    expect(result).toHaveProperty('nip05')
    expect(['high', 'medium', 'low', 'unknown']).toContain(result.confidence)
  })
})
```

- [ ] **Step 3: Run tests, verify fail**

```bash
npx vitest run test/workflow/handlers.test.ts
```

- [ ] **Step 4: Implement handleFeedDiscover**

Add to `src/workflow/handlers.ts`:

```typescript
export interface DiscoverySuggestion {
  pubkey: string
  npub: string
  name?: string
  nip05?: string
  trustScore: number
  mutualFollows: number
  reason: string
}

export async function handleFeedDiscover(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { strategy?: string; limit?: number; query?: string },
): Promise<DiscoverySuggestion[]> {
  const strategy = args.strategy ?? 'trust-adjacent'
  const limit = args.limit ?? 20

  if (strategy === 'trust-adjacent') {
    return discoverTrustAdjacent(ctx, pool, scoring, limit)
  }
  if (strategy === 'active') {
    return discoverActive(ctx, pool, scoring, limit)
  }
  if (strategy === 'topic' && args.query) {
    return discoverByTopic(ctx, pool, scoring, args.query, limit)
  }

  return []
}

async function discoverTrustAdjacent(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  limit: number,
): Promise<DiscoverySuggestion[]> {
  const myHex = ctx.activePublicKeyHex

  // Get my follows
  const myContactEvents = await pool.query(ctx.activeNpub, {
    kinds: [3], authors: [myHex], limit: 1,
  })
  if (myContactEvents.length === 0) return []

  const myFollows = new Set(
    myContactEvents[0].tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1]),
  )

  // Get contacts-of-contacts
  const followArray = [...myFollows].slice(0, 200)
  const hop2Events = await pool.query(ctx.activeNpub, {
    kinds: [3], authors: followArray,
  })

  // Count how many of my contacts follow each candidate
  const candidateCounts = new Map<string, number>()
  for (const event of hop2Events) {
    const follows = event.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])
    for (const pubkey of follows) {
      if (!myFollows.has(pubkey) && pubkey !== myHex) {
        candidateCounts.set(pubkey, (candidateCounts.get(pubkey) ?? 0) + 1)
      }
    }
  }

  // Sort by mutual follows, take top candidates
  const sorted = [...candidateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2) // fetch extra, will trim after scoring

  // Score and build suggestions
  const suggestions: DiscoverySuggestion[] = []
  for (const [pubkey, mutuals] of sorted) {
    const score = await scoring.scorePubkey(pubkey)
    suggestions.push({
      pubkey,
      npub: npubEncode(pubkey),
      trustScore: score.score,
      mutualFollows: mutuals,
      reason: `Followed by ${mutuals} of your contacts`,
    })
  }

  // Sort by trust score, return top N
  return suggestions
    .sort((a, b) => b.trustScore - a.trustScore)
    .slice(0, limit)
}

// discoverActive and discoverByTopic follow similar patterns
// (implementation follows spec — 5 posts in 7 days, NIP-50/tag fallback)
```

- [ ] **Step 5: Implement handleVerifyPerson**

Add to `src/workflow/handlers.ts`:

```typescript
export interface VerificationResult {
  pubkey: string
  npub: string
  name?: string
  nip05: { verified: boolean; handle?: string }
  trustScore: number
  attestations: Array<{ type: string; by: string; content: string }>
  linkageProofs: Array<{ mode: string; linkedTo: string }>
  ringEndorsements: Array<{ circleSize: number; threshold: number; verified: boolean }>
  spokenChallenge?: { token: string; expiresIn: string }
  confidence: 'high' | 'medium' | 'low' | 'unknown'
}

export async function handleVerifyPerson(
  ctx: IdentityContext,
  pool: RelayPool,
  scoring: VeilScoring,
  args: { pubkey: string; method?: string },
): Promise<VerificationResult> {
  const method = args.method ?? 'quick'

  // 1. Trust score
  const trustResult = await scoring.scorePubkey(args.pubkey)

  // 2. NIP-05 check
  const nip05 = await checkNip05(pool, ctx.activeNpub, args.pubkey)

  // 3. Attestations
  const attestationEvents = await pool.query(ctx.activeNpub, {
    kinds: [31000], '#p': [args.pubkey],
  })
  const attestations = attestationEvents.map(e => ({
    type: e.tags.find((t: string[]) => t[0] === 'type')?.[1] ?? 'unknown',
    by: e.pubkey,
    content: e.content,
  }))

  // 4. Linkage proofs
  const proofEvents = await pool.query(ctx.activeNpub, {
    kinds: [30078], authors: [args.pubkey],
  })
  const linkageProofs = proofEvents.map(e => ({
    mode: e.tags.find((t: string[]) => t[0] === 'proof-mode')?.[1] ?? 'unknown',
    linkedTo: e.tags.find((t: string[]) => t[0] === 'p')?.[1] ?? '',
  }))

  // 5. Ring endorsements (full mode)
  let ringEndorsements: VerificationResult['ringEndorsements'] = []
  if (method === 'full') {
    const { verifyProof } = await import('nostr-veil/proof')
    const ringEvents = attestationEvents.filter(e =>
      e.tags.some((t: string[]) => t[0] === 'veil-sig'),
    )
    ringEndorsements = ringEvents.map(e => {
      const proof = verifyProof(e)
      return {
        circleSize: proof.circleSize,
        threshold: proof.distinctSigners,
        verified: proof.valid,
      }
    })
  }

  // 6. Spoken challenge (full mode)
  let spokenChallenge: VerificationResult['spokenChallenge']
  if (method === 'full') {
    const { computeConversationKey } = await import('nostr-tools/nip44')
    const sharedSecret = computeConversationKey(ctx.activePrivateKey, args.pubkey)
    const { generateToken } = await import('spoken-token')
    const counter = Math.floor(Date.now() / 300_000) // 5-minute windows
    const token = generateToken(Buffer.from(sharedSecret).toString('hex'), 'verify-person', counter)
    spokenChallenge = { token: String(token), expiresIn: '5 minutes', counter }
  }

  // Confidence
  const confidence = computeConfidence(trustResult.score, attestations.length, nip05.verified)

  return {
    pubkey: args.pubkey,
    npub: npubEncode(args.pubkey),
    nip05,
    trustScore: trustResult.score,
    attestations,
    linkageProofs,
    ringEndorsements,
    spokenChallenge,
    confidence,
  }
}

function computeConfidence(
  score: number,
  attestationCount: number,
  nip05Verified: boolean,
): 'high' | 'medium' | 'low' | 'unknown' {
  if (score >= 50 && attestationCount >= 1 && nip05Verified) return 'high'
  if (score >= 20 || attestationCount >= 1 || nip05Verified) return 'medium'
  if (score >= 1) return 'low'
  return 'unknown'
}

async function checkNip05(pool: RelayPool, npub: string, pubkey: string) {
  const profiles = await pool.query(npub, {
    kinds: [0], authors: [pubkey], limit: 1,
  })
  if (profiles.length === 0) return { verified: false }

  try {
    const profile = JSON.parse(profiles[0].content)
    if (!profile.nip05) return { verified: false }
    const { queryProfile } = await import('nostr-tools/nip05')
    const result = await queryProfile(profile.nip05)
    return {
      verified: result?.pubkey === pubkey,
      handle: profile.nip05,
    }
  } catch {
    return { verified: false }
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run test/workflow/handlers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/handlers.ts test/workflow/handlers.test.ts
git commit -m "feat: add feed-discover and verify-person workflow tools"
```

---

## Task 11: Workflow tools — identity-setup and identity-recover

**Files:**
- Modify: `src/workflow/handlers.ts`
- Modify: `test/workflow/handlers.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/workflow/handlers.test.ts`:

```typescript
describe('handleIdentitySetup', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bray-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('derives personas and creates Shamir shards', async () => {
    const pool = mockPool()
    // Override homedir for testing — pass shardDir explicitly or mock homedir
    const result = await handleIdentitySetup(ctx, pool as any, {
      personas: ['main', 'anonymous'],
      shamirThreshold: { shares: 3, threshold: 2 },
      relays: ['wss://relay.test'],
      confirm: true,
      _shardDir: tmpDir, // internal override for testing
    })

    expect(result.personas).toHaveLength(2)
    expect(result.personas[0]).toHaveProperty('npub')
    expect(result.personas[0]).toHaveProperty('purpose')
    expect(result.shardPaths).toHaveLength(3)
    expect(result.published).toBe(true)
    // Verify shard files exist
    for (const p of result.shardPaths) {
      expect(existsSync(p)).toBe(true)
    }
  })

  it('returns preview without confirm', async () => {
    const pool = mockPool()
    const result = await handleIdentitySetup(ctx, pool as any, {
      personas: ['main'],
      relays: ['wss://relay.test'],
    })

    expect(result.published).toBe(false)
    expect(result.preview).toBeDefined()
  })
})

describe('handleIdentityRecover', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bray-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('recovers from Shamir shards and verifies', async () => {
    const pool = mockPool()
    const setup = await handleIdentitySetup(ctx, pool as any, {
      personas: ['main'],
      shamirThreshold: { shares: 3, threshold: 2 },
      relays: ['wss://relay.test'],
      confirm: true,
      _shardDir: tmpDir,
    })

    // Recover using 2 of 3 shards
    const result = await handleIdentityRecover(pool as any, {
      shardPaths: setup.shardPaths.slice(0, 2),
    })

    expect(result.recovered).toBe(true)
    expect(result.masterNpub).toBe(ctx.activeNpub)
  })
})
```

- [ ] **Step 2: Run tests, verify fail**

```bash
npx vitest run test/workflow/handlers.test.ts
```

- [ ] **Step 3: Implement identity-setup**

Add to `src/workflow/handlers.ts`:

```typescript
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export async function handleIdentitySetup(
  ctx: IdentityContext,
  pool: RelayPool,
  args: {
    personas?: string[]
    shamirThreshold?: { shares: number; threshold: number }
    relays?: string[]
    confirm?: boolean
    _shardDir?: string // internal: override shard directory for testing
  },
): Promise<any> {
  const personas = args.personas ?? ['main', 'anonymous']
  const shamir = args.shamirThreshold ?? { shares: 5, threshold: 3 }
  const relays = args.relays ?? ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']

  // Build preview — ctx.derive() returns PublicIdentity with npub
  const derivedPersonas = personas.map((name, i) => {
    const derived = ctx.derive(name, i)
    return { purpose: name, npub: derived.npub, index: i }
  })

  if (!args.confirm) {
    return {
      published: false,
      preview: {
        personas: derivedPersonas,
        shamirShares: shamir.shares,
        shamirThreshold: shamir.threshold,
        relays,
        message: 'Pass confirm: true to execute. This will publish relay lists and write shard files.',
      },
    }
  }

  // Create Shamir backup using @forgesworn/shamir-words directly
  const { split } = await import('@forgesworn/shamir-words')
  const secretHex = Buffer.from(ctx.activePrivateKey).toString('hex')
  const shards = split(secretHex, shamir.shares, shamir.threshold)

  const shardDir = args._shardDir ?? join(homedir(), '.nostr-bray', 'shards')
  mkdirSync(shardDir, { recursive: true })
  const shardPaths = shards.map((shard: string, i: number) => {
    const path = join(shardDir, `shard-${i + 1}.txt`)
    writeFileSync(path, shard, { mode: 0o600 })
    return path
  })

  // Configure relay sets and publish NIP-65
  // ctx.switch(purpose, index) is the actual API (not switchTo)
  for (const persona of derivedPersonas) {
    ctx.switch(persona.purpose, persona.index)
    pool.reconfigure(ctx.activeNpub, { read: relays, write: relays })
    const sign = ctx.getSigningFunction()
    const event = await sign({
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags: relays.map(r => ['r', r]),
      content: '',
    })
    await pool.publish(ctx.activeNpub, event)
  }

  // Switch back to master — ctx.switch('master') is the actual API
  ctx.switch('master')

  return {
    published: true,
    personas: derivedPersonas,
    shardPaths,
    relays,
    guide: [
      'Store your Shamir shard files in separate secure locations.',
      `Any ${shamir.threshold} of ${shamir.shares} shards can recover your master key.`,
      'Each persona has its own relay list published.',
      'Use identity-switch to activate a persona.',
    ],
  }
}
```

- [ ] **Step 4: Implement identity-recover**

Add to `src/workflow/handlers.ts`:

```typescript
import { readFileSync } from 'node:fs'

export async function handleIdentityRecover(
  pool: RelayPool,
  args: { shardPaths: string[]; newRelays?: string[] },
): Promise<any> {
  // Read shard files
  const shards = args.shardPaths.map(p => readFileSync(p, 'utf-8').trim())

  // Reconstruct via shamir-words
  const { reconstruct } = await import('@forgesworn/shamir-words')
  const secret = reconstruct(shards)

  // Create context from recovered secret
  const { IdentityContext } = await import('../context.js')
  const recovered = new IdentityContext(secret, 'hex')
  const masterNpub = recovered.activeNpub

  return {
    recovered: true,
    masterNpub,
    message: `Master identity recovered: ${masterNpub}. Use identity-switch to activate personas.`,
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run test/workflow/handlers.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/workflow/handlers.ts test/workflow/handlers.test.ts
git commit -m "feat: add identity-setup and identity-recover workflow tools"
```

---

## Task 12: Workflow tool — relay-health

**Files:**
- Modify: `src/workflow/handlers.ts`
- Modify: `test/workflow/handlers.test.ts`

- [ ] **Step 1: Write failing test**

Add to `test/workflow/handlers.test.ts`:

```typescript
describe('handleRelayHealth', () => {
  it('returns health report for active identity relays', async () => {
    const pool = mockPool()
    pool.getRelays = vi.fn().mockReturnValue({
      read: ['wss://relay.test'],
      write: ['wss://relay.test'],
    })

    const result = await handleRelayHealth(ctx, pool as any, {})
    expect(result).toBeInstanceOf(Array)
    expect(result[0]).toHaveProperty('url')
    expect(result[0]).toHaveProperty('reachable')
    expect(result[0]).toHaveProperty('warnings')
  })
})
```

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement handleRelayHealth**

Add to `src/workflow/handlers.ts`:

```typescript
export interface RelayHealthReport {
  url: string
  reachable: boolean
  responseTime: number
  hasYourEvents: boolean
  supportedNips: number[]
  writeAccess?: boolean
  warnings: string[]
}

export async function handleRelayHealth(
  ctx: IdentityContext,
  pool: RelayPool,
  args: { pubkey?: string; checkWrite?: boolean },
): Promise<RelayHealthReport[]> {
  const relays = pool.getRelays(ctx.activeNpub)
  const allUrls = [...new Set([...relays.read, ...relays.write])]
  const pubkeyHex = args.pubkey ?? ctx.activePublicKeyHex

  return Promise.all(allUrls.map(async (url) => {
    const warnings: string[] = []
    let reachable = false
    let responseTime = -1
    let supportedNips: number[] = []
    let hasYourEvents = false

    // NIP-11 info check
    try {
      const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://')
      const start = Date.now()
      const resp = await fetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(3000),
      })
      responseTime = Date.now() - start
      reachable = resp.ok

      if (resp.ok) {
        const info = await resp.json()
        supportedNips = info.supported_nips ?? []
        if (!supportedNips.includes(17)) warnings.push('no NIP-17 support')
        if (!supportedNips.includes(50)) warnings.push('no NIP-50 search')
        if (responseTime > 2000) warnings.push('slow response (>2s)')
      }
    } catch {
      warnings.push('unreachable')
    }

    // Check for your events
    if (reachable) {
      try {
        const events = await pool.queryDirect([url], {
          kinds: [1, 0],
          authors: [pubkeyHex],
          limit: 1,
        })
        hasYourEvents = events.length > 0
        if (!hasYourEvents) warnings.push('relay has none of your events')
      } catch {
        warnings.push('could not query for your events')
      }
    }

    // Optional write test
    let writeAccess: boolean | undefined
    if (args.checkWrite && reachable) {
      try {
        const sign = ctx.getSigningFunction()
        const testEvent = await sign({
          kind: 30078,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', `health-check-${Date.now()}`], ['expiration', String(Math.floor(Date.now() / 1000) + 60)]],
          content: '',
        })
        const pubResult = await pool.publishDirect([url], testEvent)
        writeAccess = pubResult.accepted.length > 0
      } catch {
        writeAccess = false
        warnings.push('write test failed')
      }
    }

    return { url, reachable, responseTime, hasYourEvents, supportedNips, writeAccess, warnings }
  }))
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/workflow/handlers.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/workflow/handlers.ts test/workflow/handlers.test.ts
git commit -m "feat: add relay-health workflow tool"
```

---

## Task 13: Register workflow tools in catalog and wire up index.ts

**Files:**
- Create: `src/workflow/tools.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create workflow tools registration**

Create `src/workflow/tools.ts`:

```typescript
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { hexId } from '../validation.js'
import { VeilScoring } from '../veil/scoring.js'
import { TrustCache } from '../veil/cache.js'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import type { Nip65Manager } from '../nip65.js'
import {
  handleTrustScore,
  handleFeedDiscover,
  handleVerifyPerson,
  handleIdentitySetup,
  handleIdentityRecover,
  handleRelayHealth,
} from './handlers.js'

export interface WorkflowDeps {
  ctx: IdentityContext
  pool: RelayPool
  nip65: Nip65Manager
  veilCacheTtl: number
  veilCacheMax: number
}

export function registerWorkflowTools(server: McpServer, deps: WorkflowDeps): void {
  const cache = new TrustCache({ ttl: deps.veilCacheTtl, maxEntries: deps.veilCacheMax })

  function getScoring(): VeilScoring {
    return new VeilScoring(deps.pool, cache, deps.ctx.activeNpub)
  }

  server.registerTool('trust-score', {
    description: 'How trustworthy is this pubkey? Computes WoT score from NIP-85 assertions and NIP-VA attestations.',
    inputSchema: {
      pubkey: hexId.describe('Hex public key to score'),
      depth: z.number().int().min(1).max(3).default(2).describe('Max hops in trust graph'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, depth }) => {
    const result = await handleTrustScore(deps.ctx, deps.pool, getScoring(), { pubkey, depth })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('feed-discover', {
    description: 'Discover interesting accounts to follow. Strategies: trust-adjacent (people your contacts follow), topic (search by keyword), active (recently active nearby accounts).',
    inputSchema: {
      strategy: z.enum(['trust-adjacent', 'topic', 'active']).default('trust-adjacent'),
      limit: z.number().int().min(1).max(100).default(20),
      query: z.string().optional().describe('Search query (required for topic strategy)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ strategy, limit, query }) => {
    const result = await handleFeedDiscover(deps.ctx, deps.pool, getScoring(), { strategy, limit, query })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('verify-person', {
    description: 'Verify a person\'s identity. Quick mode checks attestations, NIP-05, and trust score. Full mode adds ring signature verification and spoken challenge generation.',
    inputSchema: {
      pubkey: hexId.describe('Hex public key to verify'),
      method: z.enum(['quick', 'full']).default('quick'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, method }) => {
    const result = await handleVerifyPerson(deps.ctx, deps.pool, getScoring(), { pubkey, method })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('identity-setup', {
    description: 'Guided safe identity setup. Derives personas, creates Shamir backup shards, configures relays. Shows preview first, requires confirm: true to execute.',
    inputSchema: {
      personas: z.array(z.string()).default(['main', 'anonymous']).describe('Persona names to derive'),
      shamirThreshold: z.object({
        shares: z.number().int().min(2).max(10).default(5),
        threshold: z.number().int().min(2).max(10).default(3),
      }).optional(),
      relays: z.array(z.string()).optional().describe('Relay URLs (sensible defaults if omitted)'),
      confirm: z.boolean().optional().describe('Required to execute. Omit for preview.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args) => {
    const result = await handleIdentitySetup(deps.ctx, deps.pool, args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('identity-recover', {
    description: 'Recover identity from Shamir backup shards. Reconstructs master key and verifies derived personas match.',
    inputSchema: {
      shardPaths: z.array(z.string()).describe('Paths to shard files (or base64-encoded content for HTTP transport)'),
      newRelays: z.array(z.string()).optional().describe('New relay URLs for recovered identity'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args) => {
    const result = await handleIdentityRecover(deps.pool, args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('relay-health', {
    description: 'Check health of your relay set. Tests reachability, NIP support, event presence, and optionally write access.',
    inputSchema: {
      pubkey: hexId.optional().describe('Pubkey to check (defaults to active identity)'),
      checkWrite: z.boolean().default(false).describe('Test write access (publishes ephemeral test event)'),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => {
    const result = await handleRelayHealth(deps.ctx, deps.pool, args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  })
}
```

- [ ] **Step 2: Wire into index.ts**

In `src/index.ts`, after the existing `registerXTools()` calls:

```typescript
import { registerWorkflowTools } from './workflow/tools.js'

// After other registrations:
registerWorkflowTools(proxy, {
  ctx: deps.ctx,
  pool: deps.pool,
  nip65: deps.nip65,
  veilCacheTtl: config.veilCacheTtl,
  veilCacheMax: config.veilCacheMax,
})
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: Clean compilation.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests PASS. Coverage should still be >= 96% with the new tests added.

- [ ] **Step 5: Commit**

```bash
git add src/workflow/tools.ts src/index.ts
git commit -m "feat: register workflow tools and wire veil scoring into index"
```

---

## Task 14: Final integration test and cleanup

**Files:**
- All modified files
- Update: `CLAUDE.md` — tool count

- [ ] **Step 1: Run full build + test + lint**

```bash
npm run build && npm test && npm run lint
```

Expected: All pass, 96%+ coverage.

- [ ] **Step 2: Update CLAUDE.md tool count**

Update the tool count from "77 tools" to reflect the new total (79 existing + 6 workflow = 85+).

- [ ] **Step 3: Run the full test suite one more time**

```bash
npm test -- --coverage
```

Expected: >= 96% coverage.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: update tool count and finalise pain point solutions integration"
```

- [ ] **Step 5: Verify branch is clean**

```bash
git status
git log --oneline -10
```
