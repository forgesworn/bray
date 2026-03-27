# NIP Additions + README Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NIP-05 (complete), NIP-50 (search), NIP-45 (COUNT), NIP-42 (relay AUTH) support and update README to document all ~54 undocumented tools.

**Architecture:** Each NIP follows the existing handler/tools split pattern. NIP-05 gets its own handler file under identity/. NIP-50 extends the existing relay-query tool. NIP-45 and NIP-42 each get new handler files under relay/. All new tools are discoverable (not promoted). README is updated last to capture everything.

**Tech Stack:** TypeScript, vitest, nostr-tools v2.23.3, zod schemas, MCP server framework

---

### Task 1: NIP-05 Handlers

**Files:**
- Create: `src/identity/nip05.ts`
- Modify: `src/workflow/handlers.ts:513-527` (remove `verifyNip05`, replace with import)

- [ ] **Step 1: Create `src/identity/nip05.ts` with all three handler functions**

```typescript
import { validatePublicUrl } from '../validation.js'

export interface Nip05LookupResult {
  pubkey: string
  relays?: string[]
  identifier: string
}

export interface Nip05VerifyResult {
  verified: boolean
  identifier: string
  pubkey: string
}

export interface Nip05RelaysResult {
  identifier: string
  relays: Record<string, string[]>
}

interface Nip05Response {
  names?: Record<string, string>
  relays?: Record<string, string[]>
}

const NIP05_TIMEOUT = 5_000
const NIP05_MAX_SIZE = 256 * 1024 // 256 KB

async function fetchNostrJson(identifier: string): Promise<{ localPart: string; domain: string; json: Nip05Response }> {
  const [localPart, domain] = identifier.split('@')
  if (!localPart || !domain) {
    throw new Error('Invalid NIP-05 identifier: expected user@domain format')
  }

  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(localPart)}`
  validatePublicUrl(url)

  const resp = await fetch(url, { signal: AbortSignal.timeout(NIP05_TIMEOUT) })
  if (!resp.ok) {
    throw new Error(`NIP-05 fetch failed: ${resp.status} ${resp.statusText}`)
  }

  const text = await resp.text()
  if (text.length > NIP05_MAX_SIZE) {
    throw new Error('NIP-05 response too large')
  }

  const json = JSON.parse(text) as Nip05Response
  return { localPart, domain, json }
}

/** Look up a NIP-05 identifier and return the associated pubkey and relay hints */
export async function handleNip05Lookup(identifier: string): Promise<Nip05LookupResult> {
  const { localPart, json } = await fetchNostrJson(identifier)
  const pubkey = json.names?.[localPart]
  if (!pubkey) {
    throw new Error(`No pubkey found for ${identifier}`)
  }

  const relays = pubkey && json.relays?.[pubkey]
  return {
    pubkey,
    relays: relays?.length ? relays : undefined,
    identifier,
  }
}

/** Verify that a NIP-05 identifier resolves to the expected pubkey */
export async function handleNip05Verify(pubkey: string, identifier: string): Promise<Nip05VerifyResult> {
  try {
    const { localPart, json } = await fetchNostrJson(identifier)
    const resolved = json.names?.[localPart]
    return { verified: resolved === pubkey, identifier, pubkey }
  } catch {
    return { verified: false, identifier, pubkey }
  }
}

/** Fetch relay hints from a NIP-05 identifier */
export async function handleNip05Relays(identifier: string): Promise<Nip05RelaysResult> {
  const { json } = await fetchNostrJson(identifier)
  return {
    identifier,
    relays: json.relays ?? {},
  }
}

/** Verify NIP-05 identifier against a pubkey (shared helper for workflow) */
export async function verifyNip05(pubkeyHex: string, nip05: string): Promise<boolean> {
  const result = await handleNip05Verify(pubkeyHex, nip05)
  return result.verified
}
```

- [ ] **Step 2: Update `src/workflow/handlers.ts` to import from the new module**

Replace the local `verifyNip05` function (lines 512-527) with an import:

At the top of `src/workflow/handlers.ts`, add:
```typescript
import { verifyNip05 } from '../identity/nip05.js'
```

Delete the local `verifyNip05` function (lines 512-527):
```typescript
/** Verify NIP-05 identifier against a pubkey */
async function verifyNip05(pubkeyHex: string, nip05: string): Promise<boolean> {
  try {
    const [localPart, domain] = nip05.split('@')
    if (!localPart || !domain) return false

    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(localPart)}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!resp.ok) return false

    const json = await resp.json() as { names?: Record<string, string> }
    return json.names?.[localPart] === pubkeyHex
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Run build to verify no compilation errors**

Run: `npm run lint`
Expected: Clean (no errors)

- [ ] **Step 4: Commit**

```bash
git add src/identity/nip05.ts src/workflow/handlers.ts
git commit -m "feat: add NIP-05 handlers and extract shared verifyNip05"
```

---

### Task 2: NIP-05 Tests

**Files:**
- Create: `test/identity/nip05.test.ts`

- [ ] **Step 1: Write tests for all NIP-05 handlers**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleNip05Lookup, handleNip05Verify, handleNip05Relays, verifyNip05 } from '../../src/identity/nip05.js'

const VALID_RESPONSE = JSON.stringify({
  names: { bob: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1' },
  relays: { abc123def456abc123def456abc123def456abc123def456abc123def456abc1: ['wss://relay.example.com'] },
})

const NO_RELAYS_RESPONSE = JSON.stringify({
  names: { alice: 'def456abc123def456abc123def456abc123def456abc123def456abc123def4' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleNip05Lookup', () => {
  it('resolves identifier to pubkey and relay hints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Lookup('bob@example.com')
    expect(result.pubkey).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abc1')
    expect(result.relays).toEqual(['wss://relay.example.com'])
    expect(result.identifier).toBe('bob@example.com')
  })

  it('returns no relays when not present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => NO_RELAYS_RESPONSE }))
    const result = await handleNip05Lookup('alice@example.com')
    expect(result.pubkey).toBe('def456abc123def456abc123def456abc123def456abc123def456abc123def4')
    expect(result.relays).toBeUndefined()
  })

  it('throws on invalid identifier format', async () => {
    await expect(handleNip05Lookup('noatsign')).rejects.toThrow(/user@domain/)
  })

  it('throws when name not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => JSON.stringify({ names: {} }) }))
    await expect(handleNip05Lookup('ghost@example.com')).rejects.toThrow(/No pubkey/)
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }))
    await expect(handleNip05Lookup('bob@gone.com')).rejects.toThrow(/404/)
  })

  it('throws on oversized response', async () => {
    const big = 'x'.repeat(256 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => big }))
    await expect(handleNip05Lookup('bob@big.com')).rejects.toThrow(/too large/)
  })

  it('rejects private network URLs', async () => {
    await expect(handleNip05Lookup('bob@127.0.0.1')).rejects.toThrow(/private/)
  })
})

describe('handleNip05Verify', () => {
  it('returns verified true when pubkey matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Verify(
      'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      'bob@example.com',
    )
    expect(result.verified).toBe(true)
  })

  it('returns verified false when pubkey does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Verify('wrong_pubkey_value_here_padded_to_64_chars_0000000000000000000000', 'bob@example.com')
    expect(result.verified).toBe(false)
  })

  it('returns verified false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await handleNip05Verify('abc123', 'bob@offline.com')
    expect(result.verified).toBe(false)
  })
})

describe('handleNip05Relays', () => {
  it('returns relay map when present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const result = await handleNip05Relays('bob@example.com')
    expect(result.relays).toHaveProperty('abc123def456abc123def456abc123def456abc123def456abc123def456abc1')
  })

  it('returns empty object when no relays field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => NO_RELAYS_RESPONSE }))
    const result = await handleNip05Relays('alice@example.com')
    expect(result.relays).toEqual({})
  })
})

describe('verifyNip05 (shared helper)', () => {
  it('returns true for matching pubkey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const ok = await verifyNip05('abc123def456abc123def456abc123def456abc123def456abc123def456abc1', 'bob@example.com')
    expect(ok).toBe(true)
  })

  it('returns false for non-matching pubkey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => VALID_RESPONSE }))
    const ok = await verifyNip05('0000000000000000000000000000000000000000000000000000000000000000', 'bob@example.com')
    expect(ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run test/identity/nip05.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All 329+ tests pass (workflow tests still work with imported verifyNip05)

- [ ] **Step 4: Commit**

```bash
git add test/identity/nip05.test.ts
git commit -m "test: add NIP-05 handler tests"
```

---

### Task 3: NIP-05 Tool Registration

**Files:**
- Modify: `src/identity/tools.ts:17-19` (add import)
- Modify: `src/identity/tools.ts:219` (add tool registrations before closing brace)

- [ ] **Step 1: Add import to `src/identity/tools.ts`**

After line 19 (`import { handleIdentityBackup, handleIdentityRestore, handleIdentityMigrate } from './migration.js'`), add:

```typescript
import { handleNip05Lookup, handleNip05Verify, handleNip05Relays } from './nip05.js'
```

- [ ] **Step 2: Add three tool registrations before the closing brace of `registerIdentityTools`**

Insert before the final `}` of `registerIdentityTools` (before line 220):

```typescript
  server.registerTool('nip05-lookup', {
    description: 'Resolve a NIP-05 identifier (user@domain) to a Nostr pubkey. Also returns relay hints if the server provides them. Use this to find someone\'s pubkey from their human-readable address.',
    inputSchema: {
      identifier: z.string().describe('NIP-05 identifier (e.g. bob@example.com)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ identifier }) => {
    const result = await handleNip05Lookup(identifier)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('nip05-verify', {
    description: 'Verify that a NIP-05 identifier (user@domain) resolves to the expected pubkey. Returns { verified: true/false }. Use this to confirm someone\'s claimed NIP-05 identity.',
    inputSchema: {
      pubkey: hexId.describe('Hex pubkey to verify against'),
      identifier: z.string().describe('NIP-05 identifier (e.g. bob@example.com)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, identifier }) => {
    const result = await handleNip05Verify(pubkey, identifier)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })

  server.registerTool('nip05-relays', {
    description: 'Fetch relay hints from a NIP-05 identifier. The NIP-05 server can suggest preferred relays for each pubkey. Returns a map of pubkey to relay URLs. Useful for relay discovery before messaging someone.',
    inputSchema: {
      identifier: z.string().describe('NIP-05 identifier (e.g. bob@example.com)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ identifier }) => {
    const result = await handleNip05Relays(identifier)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
```

- [ ] **Step 3: Run build and tests**

Run: `npm run lint && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/identity/tools.ts
git commit -m "feat: register nip05-lookup, nip05-verify, nip05-relays tools"
```

---

### Task 4: NIP-50 Search Filter

**Files:**
- Modify: `src/relay/handlers.ts:128-136` (add search to RelayQueryArgs)
- Modify: `src/relay/handlers.ts:143-157` (add search to filter building)
- Modify: `src/relay/tools.ts:56-86` (add search param to relay-query schema)

- [ ] **Step 1: Add `search` to `RelayQueryArgs` in `src/relay/handlers.ts`**

Replace the `RelayQueryArgs` interface (lines 128-136):

```typescript
export interface RelayQueryArgs {
  kinds?: number[]
  authors?: string[]
  tags?: Record<string, string[]>
  since?: number
  until?: number
  limit?: number
  relays?: string[]
  search?: string
}
```

- [ ] **Step 2: Add search parameter to filter building in `handleRelayQuery`**

In `handleRelayQuery` (after the tags block, before the `if (args.relays?.length)` check around line 158), add:

```typescript
  // NIP-50 full-text search (only works on relays that support it)
  if (args.search) {
    ;(filter as Record<string, unknown>).search = args.search
  }
```

- [ ] **Step 3: Add `search` to the relay-query tool schema in `src/relay/tools.ts`**

In the `relay-query` tool registration (after the `relays` param, around line 65), add:

```typescript
      search: z.string().optional().describe('Full-text search query (NIP-50). Only works on relays that support NIP-50; others will ignore it.'),
```

Pass `search` through to the handler call (line 69):

```typescript
    const events = await handleRelayQuery(deps.pool, deps.ctx.activeNpub, {
      kinds, authors, tags, since, until, limit, relays, search,
    })
```

- [ ] **Step 4: Add test for search filter in `test/relay/handlers.test.ts`**

Add to the `handleRelayQuery` describe block:

```typescript
    it('adds NIP-50 search parameter to filter', async () => {
      const pool = mockPool()
      await handleRelayQuery(pool as any, ctx.activeNpub, {
        kinds: [1],
        search: 'hello world',
      })
      expect(pool.query).toHaveBeenCalledWith(
        ctx.activeNpub,
        expect.objectContaining({ search: 'hello world' }),
      )
    })
```

- [ ] **Step 5: Run tests**

Run: `npm run lint && npx vitest run test/relay/handlers.test.ts`
Expected: All tests pass including new search test

- [ ] **Step 6: Commit**

```bash
git add src/relay/handlers.ts src/relay/tools.ts test/relay/handlers.test.ts
git commit -m "feat: add NIP-50 search parameter to relay-query"
```

---

### Task 5: NIP-45 COUNT Handler

**Files:**
- Create: `src/relay/count.ts`

- [ ] **Step 1: Create `src/relay/count.ts`**

```typescript
import { validateRelayUrl } from './handlers.js'

export interface CountResult {
  relay: string
  count: number
  estimated?: boolean
  fallback?: boolean
  error?: string
}

export interface RelayCountResult {
  counts: CountResult[]
  total: number
}

/**
 * Send a COUNT request to relays using the lower-level WebSocket protocol.
 * Falls back to fetch-and-count if the relay does not support NIP-45.
 */
export async function handleRelayCount(
  relays: string[],
  filter: Record<string, unknown>,
  poolQuery?: (relays: string[], filter: Record<string, unknown>) => Promise<unknown[]>,
): Promise<RelayCountResult> {
  for (const url of relays) validateRelayUrl(url)

  const results = await Promise.all(
    relays.map(url => countFromRelay(url, filter, poolQuery)),
  )

  return {
    counts: results,
    total: results.reduce((sum, r) => sum + (r.error ? 0 : r.count), 0),
  }
}

async function countFromRelay(
  url: string,
  filter: Record<string, unknown>,
  poolQuery?: (relays: string[], filter: Record<string, unknown>) => Promise<unknown[]>,
): Promise<CountResult> {
  try {
    return await countViaWebSocket(url, filter)
  } catch (err) {
    // Relay does not support COUNT -- fall back to fetch-and-count
    if (poolQuery) {
      try {
        const fallbackFilter = { ...filter, limit: 1000 }
        const events = await poolQuery([url], fallbackFilter)
        return {
          relay: url,
          count: events.length,
          fallback: true,
          estimated: events.length >= 1000,
        }
      } catch (fallbackErr) {
        return {
          relay: url,
          count: 0,
          error: `COUNT not supported and fallback failed: ${(fallbackErr as Error).message}`,
        }
      }
    }
    return {
      relay: url,
      count: 0,
      error: `COUNT not supported: ${(err as Error).message}`,
    }
  }
}

function countViaWebSocket(url: string, filter: Record<string, unknown>): Promise<CountResult> {
  return new Promise((resolve, reject) => {
    const subId = `count-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.close()
        reject(new Error('COUNT request timed out'))
      }
    }, 5_000)

    const WsImpl = globalThis.WebSocket ?? (async () => (await import('ws')).default)()
    const wsPromise = WsImpl instanceof Promise ? WsImpl : Promise.resolve(WsImpl)

    let ws: InstanceType<typeof WebSocket>

    wsPromise.then(WsClass => {
      ws = new (WsClass as any)(url) as InstanceType<typeof WebSocket>

      ws.onopen = () => {
        ws.send(JSON.stringify(['COUNT', subId, filter]))
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
          if (Array.isArray(msg) && msg[0] === 'COUNT' && msg[1] === subId) {
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              ws.close()
              const countObj = msg[2] as { count: number; approximate?: boolean }
              resolve({
                relay: url,
                count: countObj.count,
                estimated: countObj.approximate,
              })
            }
          } else if (Array.isArray(msg) && msg[0] === 'NOTICE') {
            // Relay sent a NOTICE instead of COUNT -- likely unsupported
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              ws.close()
              reject(new Error(`Relay NOTICE: ${msg[1]}`))
            }
          }
        } catch { /* ignore parse errors from non-COUNT messages */ }
      }

      ws.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error('WebSocket connection failed'))
        }
      }

      ws.onclose = () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error('WebSocket closed before COUNT response'))
        }
      }
    }).catch(err => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
    })
  })
}
```

- [ ] **Step 2: Run build**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/relay/count.ts
git commit -m "feat: add NIP-45 COUNT handler with WebSocket and fallback"
```

---

### Task 6: NIP-45 COUNT Tests

**Files:**
- Create: `test/relay/count.test.ts`

- [ ] **Step 1: Write COUNT handler tests**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleRelayCount } from '../../src/relay/count.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleRelayCount', () => {
  it('rejects private network relay URLs', async () => {
    await expect(
      handleRelayCount(['wss://127.0.0.1'], { kinds: [1] }),
    ).rejects.toThrow(/private/)
  })

  it('falls back to fetch-and-count when poolQuery provided', async () => {
    // Mock WebSocket to fail (simulating no COUNT support)
    const mockWs = {
      onopen: null as any,
      onmessage: null as any,
      onerror: null as any,
      onclose: null as any,
      send: vi.fn(),
      close: vi.fn(),
    }
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = mockWs.send
      close = mockWs.close
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const mockPoolQuery = vi.fn().mockResolvedValue(
      Array(42).fill({ id: 'x', kind: 1 }),
    )

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
      mockPoolQuery,
    )

    expect(result.counts[0].count).toBe(42)
    expect(result.counts[0].fallback).toBe(true)
    expect(result.total).toBe(42)
  })

  it('marks result as estimated when fallback hits 1000 cap', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const mockPoolQuery = vi.fn().mockResolvedValue(
      Array(1000).fill({ id: 'x', kind: 1 }),
    )

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
      mockPoolQuery,
    )

    expect(result.counts[0].estimated).toBe(true)
    expect(result.counts[0].fallback).toBe(true)
  })

  it('returns error when no fallback and COUNT fails', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
    )

    expect(result.counts[0].error).toBeDefined()
    expect(result.counts[0].count).toBe(0)
    expect(result.total).toBe(0)
  })

  it('resolves count from successful WebSocket COUNT response', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onopen?.()
        }, 10)
        setTimeout(() => {
          // Extract subId from the sent message
          const sent = this.send.mock.calls[0]?.[0]
          if (sent) {
            const parsed = JSON.parse(sent)
            const subId = parsed[1]
            this.onmessage?.({ data: JSON.stringify(['COUNT', subId, { count: 99 }]) })
          }
        }, 20)
      }
    })

    const result = await handleRelayCount(
      ['wss://relay.example.com'],
      { kinds: [1] },
    )

    expect(result.counts[0].count).toBe(99)
    expect(result.counts[0].fallback).toBeUndefined()
    expect(result.total).toBe(99)
  })

  it('queries multiple relays in parallel', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onopen?.(), 10)
        setTimeout(() => {
          const sent = this.send.mock.calls[0]?.[0]
          if (sent) {
            const parsed = JSON.parse(sent)
            this.onmessage?.({ data: JSON.stringify(['COUNT', parsed[1], { count: 10 }]) })
          }
        }, 20)
      }
    })

    const result = await handleRelayCount(
      ['wss://r1.example.com', 'wss://r2.example.com'],
      { kinds: [1] },
    )

    expect(result.counts).toHaveLength(2)
    expect(result.total).toBe(20)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/relay/count.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/relay/count.test.ts
git commit -m "test: add NIP-45 COUNT handler tests"
```

---

### Task 7: NIP-45 COUNT Tool Registration

**Files:**
- Modify: `src/relay/tools.ts:7` (add import)
- Modify: `src/relay/tools.ts:99` (add tool registration before closing brace)

- [ ] **Step 1: Add import to `src/relay/tools.ts`**

After line 7 (`import { handleRelayList, handleRelaySet, handleRelayAdd, handleRelayInfo, handleRelayQuery } from './handlers.js'`), add:

```typescript
import { handleRelayCount } from './count.js'
```

- [ ] **Step 2: Add `relay-count` tool registration before the closing brace (line 100)**

```typescript
  server.registerTool('relay-count', {
    description: 'Count events matching a filter without fetching them (NIP-45). Sends a COUNT request to each relay. Falls back to fetch-and-count (capped at 1000) if the relay does not support NIP-45. Results show per-relay counts with fallback/estimated flags.',
    inputSchema: {
      relays: z.array(relayUrl).describe('Relay URLs to count from'),
      kinds: z.array(z.number().int()).optional().describe('Event kinds to filter by'),
      authors: z.array(z.string()).optional().describe('Hex pubkeys of event authors'),
      tags: z.record(z.string(), z.array(z.string())).optional().describe('Tag filters as key-value pairs'),
      since: z.number().int().optional().describe('Unix timestamp lower bound'),
      until: z.number().int().optional().describe('Unix timestamp upper bound'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ relays, kinds, authors, tags, since, until }) => {
    const filter: Record<string, unknown> = {}
    if (kinds?.length) filter.kinds = kinds
    if (authors?.length) filter.authors = authors
    if (since) filter.since = since
    if (until) filter.until = until
    if (tags) {
      for (const [key, values] of Object.entries(tags)) {
        const tagKey = key.startsWith('#') ? key : `#${key}`
        filter[tagKey] = values
      }
    }

    const poolQuery = async (urls: string[], f: Record<string, unknown>) => {
      return deps.pool.queryDirect(urls, f as any)
    }

    const result = await handleRelayCount(relays, filter, poolQuery)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
```

- [ ] **Step 3: Run build and tests**

Run: `npm run lint && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/relay/tools.ts
git commit -m "feat: register relay-count tool (NIP-45)"
```

---

### Task 8: NIP-42 Relay AUTH Handler

**Files:**
- Create: `src/relay/auth.ts`

- [ ] **Step 1: Create `src/relay/auth.ts`**

```typescript
import { validateRelayUrl } from './handlers.js'
import type { IdentityContext } from '../context.js'

export interface RelayAuthResult {
  authenticated: boolean
  relay: string
  pubkey?: string
  error?: string
}

/**
 * Authenticate to a relay that requires NIP-42 AUTH.
 *
 * Flow:
 * 1. Connect via WebSocket
 * 2. Wait for ["AUTH", challenge] message
 * 3. Sign a kind 22242 event with challenge + relay tags
 * 4. Send ["AUTH", signedEvent]
 * 5. Wait for ["OK", eventId, true, ...] confirmation
 */
export async function handleRelayAuth(
  ctx: IdentityContext,
  relay: string,
): Promise<RelayAuthResult> {
  validateRelayUrl(relay) // throws on private IPs -- intentionally not caught

  return new Promise((resolve) => {
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        try { ws.close() } catch { /* ignore */ }
        resolve({ authenticated: false, relay, error: 'AUTH handshake timed out (no challenge received)' })
      }
    }, 5_000)

    const WsImpl = globalThis.WebSocket ?? (async () => (await import('ws')).default)()
    const wsPromise = WsImpl instanceof Promise ? WsImpl : Promise.resolve(WsImpl)

    let ws: InstanceType<typeof WebSocket>

    wsPromise.then(WsClass => {
      ws = new (WsClass as any)(relay) as InstanceType<typeof WebSocket>

      ws.onmessage = async (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
          if (!Array.isArray(msg)) return

          if (msg[0] === 'AUTH' && typeof msg[1] === 'string') {
            // Received challenge
            const challenge = msg[1]
            try {
              const sign = ctx.getSigningFunction()
              const authEvent = await sign({
                kind: 22242,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ['relay', relay],
                  ['challenge', challenge],
                ],
                content: '',
              })
              ws.send(JSON.stringify(['AUTH', authEvent]))
            } catch (err) {
              if (!settled) {
                settled = true
                clearTimeout(timeout)
                ws.close()
                resolve({ authenticated: false, relay, error: `Failed to sign AUTH event: ${(err as Error).message}` })
              }
            }
          } else if (msg[0] === 'OK') {
            // OK response to our AUTH event
            const accepted = msg[2] === true
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              ws.close()
              if (accepted) {
                resolve({ authenticated: true, relay, pubkey: ctx.activePublicKeyHex })
              } else {
                const reason = typeof msg[3] === 'string' ? msg[3] : 'rejected'
                resolve({ authenticated: false, relay, error: `AUTH rejected: ${reason}` })
              }
            }
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onerror = () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ authenticated: false, relay, error: 'WebSocket connection failed' })
        }
      }

      ws.onclose = () => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve({ authenticated: false, relay, error: 'Connection closed before AUTH completed' })
        }
      }
    }).catch(err => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve({ authenticated: false, relay, error: `Failed to create WebSocket: ${(err as Error).message}` })
      }
    })
  })
}
```

- [ ] **Step 2: Run build**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/relay/auth.ts
git commit -m "feat: add NIP-42 relay AUTH handler"
```

---

### Task 9: NIP-42 AUTH Tests

**Files:**
- Create: `test/relay/auth.test.ts`

- [ ] **Step 1: Write AUTH handler tests**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleRelayAuth } from '../../src/relay/auth.js'
import { IdentityContext } from '../../src/context.js'

const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeCtx(): IdentityContext {
  return new IdentityContext(TEST_NSEC, 'nsec')
}

describe('handleRelayAuth', () => {
  it('rejects private network relay URLs', async () => {
    await expect(handleRelayAuth(makeCtx(), 'wss://127.0.0.1')).rejects.toThrow(/private/)
  })

  it('completes AUTH handshake successfully', async () => {
    const challenge = 'test-challenge-abc123'
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH' && typeof msg[1] === 'object') {
          // Respond with OK
          const eventId = msg[1].id
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', eventId, true, '']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        // Send AUTH challenge after connection
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', challenge]) })
        }, 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://auth.example.com')
    expect(result.authenticated).toBe(true)
    expect(result.relay).toBe('wss://auth.example.com')
    expect(result.pubkey).toBeDefined()
  })

  it('returns error when AUTH is rejected', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH') {
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', 'x', false, 'auth: invalid signature']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', 'challenge123']) })
        }, 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://strict.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('rejected')
  })

  it('returns error on connection failure', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        setTimeout(() => this.onerror?.(), 10)
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://down.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('connection failed')
  })

  it('times out if no challenge is received', async () => {
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn()
      close = vi.fn()
      constructor() {
        // Never send AUTH challenge
      }
    })

    const result = await handleRelayAuth(makeCtx(), 'wss://silent.example.com')
    expect(result.authenticated).toBe(false)
    expect(result.error).toContain('timed out')
  }, 10_000)

  it('signs kind 22242 with relay and challenge tags', async () => {
    let sentEvent: any = null
    vi.stubGlobal('WebSocket', class {
      onopen: any; onmessage: any; onerror: any; onclose: any
      send = vi.fn().mockImplementation((data: string) => {
        const msg = JSON.parse(data)
        if (Array.isArray(msg) && msg[0] === 'AUTH' && typeof msg[1] === 'object') {
          sentEvent = msg[1]
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify(['OK', sentEvent.id, true, '']) })
          }, 10)
        }
      })
      close = vi.fn()
      constructor() {
        setTimeout(() => {
          this.onmessage?.({ data: JSON.stringify(['AUTH', 'my-challenge']) })
        }, 10)
      }
    })

    await handleRelayAuth(makeCtx(), 'wss://verify.example.com')

    expect(sentEvent).toBeDefined()
    expect(sentEvent.kind).toBe(22242)
    expect(sentEvent.tags).toContainEqual(['relay', 'wss://verify.example.com'])
    expect(sentEvent.tags).toContainEqual(['challenge', 'my-challenge'])
    expect(sentEvent.content).toBe('')
    expect(sentEvent.sig).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/relay/auth.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/relay/auth.test.ts
git commit -m "test: add NIP-42 relay AUTH handler tests"
```

---

### Task 10: NIP-42 AUTH Tool Registration

**Files:**
- Modify: `src/relay/tools.ts` (add import and tool registration)

- [ ] **Step 1: Add import**

After the `handleRelayCount` import, add:

```typescript
import { handleRelayAuth } from './auth.js'
```

- [ ] **Step 2: Add `relay-auth` tool registration before the closing brace**

```typescript
  server.registerTool('relay-auth', {
    description: 'Authenticate to a relay that requires NIP-42 AUTH. Connects to the relay, waits for an AUTH challenge, signs a kind 22242 event, and sends it back. Returns { authenticated: true/false }. Use this when a relay-query fails due to AUTH requirements, then retry the query.',
    inputSchema: {
      relay: relayUrl.describe('Relay WebSocket URL to authenticate with'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ relay }) => {
    const result = await handleRelayAuth(deps.ctx, relay)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }
  })
```

- [ ] **Step 3: Run build and full test suite**

Run: `npm run lint && npm test`
Expected: Clean build, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/relay/tools.ts
git commit -m "feat: register relay-auth tool (NIP-42)"
```

---

### Task 11: README + Site Overhaul

**Files:**
- Modify: `README.md`
- Modify: `docs/guide.md`

This task requires reading the current README and guide, then updating them. The changes are:

- [ ] **Step 1: Read the current README.md and docs/guide.md**

Read both files in full to understand current structure before editing.

- [ ] **Step 2: Update tool group table in README.md**

Fix the tool counts to match reality. Add missing tool groups. The exact numbers should be verified by counting the actual `server.registerTool` calls in each `tools.ts` file. Add these missing groups:

- **Blossom** (file storage): update from 3 to actual count (upload, list, delete, check, discover, mirror, repair, servers-get, servers-set, usage, verify)
- **Relay Intelligence**: discover, nip-search, compare, diversity, recommend
- **Moderation**: mute, unmute, mute-list, pin, unpin, pin-list, bookmark, unbookmark, bookmark-list, label-create, label-read, label-search, plus any others
- **Privacy**: ring-sign, ring-verify, range-proof, age-verify, plus others
- **Lists**: followset-create, followset-read, bookmarkset-create, bookmarkset-read, plus others
- **Marketplace**: list, probe, plus others
- **NIP-05** (new): nip05-lookup, nip05-verify, nip05-relays

Update the NIP support section to include NIP-05 (full), NIP-42, NIP-45, NIP-50.

Update total tool count.

No em dashes anywhere in the copy.

- [ ] **Step 3: Update docs/guide.md**

Add sections for:
- NIP-05 identity lookup and verification
- NIP-50 search queries
- NIP-45 event counting
- NIP-42 relay authentication

- [ ] **Step 4: Run build to check nothing is broken**

Run: `npm run lint`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add README.md docs/guide.md
git commit -m "docs: update README with all tool groups, new NIPs, and correct counts"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (329 existing + new NIP tests)

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Verify tool count**

Run: `grep -r "server.registerTool\|registerTool(" src/ --include="*.ts" | wc -l`
Expected: Total should match what README claims

- [ ] **Step 4: Verify no em dashes in README**

Run: `grep -P '\x{2014}' README.md docs/guide.md`
Expected: No matches
