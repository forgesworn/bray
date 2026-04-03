# Bunker Key Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist NIP-46 client keys and bunker approvals across sessions so users don't re-approve every time.

**Architecture:** A shared `state.ts` module handles JSON file read/write in `~/.config/bray/`. The bunker client (`bunker-context.ts`) uses it to cache its generated client keypair keyed by bunker pubkey. The bunker server (`bunker.ts`) uses it to persist approved client pubkeys keyed by its own pubkey.

**Tech Stack:** Node.js fs (readFileSync/writeFileSync/mkdirSync), vitest, real temp directories for tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/state.ts` | Create | Read/write JSON state files in `~/.config/bray/` with `0o600` permissions |
| `src/bunker-context.ts` | Modify | Load/save client secret key via `state.ts` |
| `src/bunker.ts` | Modify | Load/save approved client pubkeys via `state.ts` |
| `test/state.test.ts` | Create | Unit tests for state file utility |
| `test/bunker-context.test.ts` | Create | Test client key persistence across connections |
| `test/bunker-round-trip.test.ts` | Modify | Test approval persistence in server |

---

### Task 1: State file utility (`src/state.ts`)

**Files:**
- Create: `src/state.ts`
- Create: `test/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readStateFile, writeStateFile } from '../src/state.js'

describe('state files', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'bray-state-test-'))
  })

  it('writeStateFile creates file with correct content', () => {
    const data = { abc123: 'def456' }
    writeStateFile('test.json', data, stateDir)
    const raw = readFileSync(join(stateDir, 'test.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual(data)
  })

  it('writeStateFile sets 0600 permissions', () => {
    writeStateFile('perms.json', {}, stateDir)
    const stat = statSync(join(stateDir, 'perms.json'))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('readStateFile returns parsed JSON', () => {
    const data = { key1: ['val1', 'val2'] }
    writeStateFile('read.json', data, stateDir)
    expect(readStateFile('read.json', stateDir)).toEqual(data)
  })

  it('readStateFile returns empty object for missing file', () => {
    expect(readStateFile('missing.json', stateDir)).toEqual({})
  })

  it('readStateFile returns empty object for corrupt JSON', () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(stateDir, 'bad.json'), 'not json{{{')
    expect(readStateFile('bad.json', stateDir)).toEqual({})
  })

  it('writeStateFile creates directory if missing', () => {
    const nested = join(stateDir, 'sub', 'dir')
    writeStateFile('nested.json', { ok: true }, nested)
    expect(existsSync(join(nested, 'nested.json'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL — `src/state.js` does not exist

- [ ] **Step 3: Implement `src/state.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_STATE_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'bray',
)

/** Read and parse a JSON state file. Returns `{}` if missing or corrupt. */
export function readStateFile<T = Record<string, unknown>>(
  name: string,
  stateDir = DEFAULT_STATE_DIR,
): T {
  const path = join(stateDir, name)
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return {} as T
  }
}

/** Write a JSON state file with 0600 permissions. Creates directory if needed. */
export function writeStateFile(
  name: string,
  data: unknown,
  stateDir = DEFAULT_STATE_DIR,
): void {
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true })
  }
  const path = join(stateDir, name)
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
  chmodSync(path, 0o600)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/state.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat: add state file utility for persistent bray state"
```

---

### Task 2: Client key persistence (`bunker-context.ts`)

**Files:**
- Modify: `src/bunker-context.ts:55-76`
- Create: `test/bunker-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/bunker-context.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getPublicKey } from 'nostr-tools/pure'
import { readStateFile } from '../src/state.js'
import { resolveClientKey } from '../src/bunker-context.js'

describe('resolveClientKey', () => {
  let stateDir: string

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'bray-client-key-test-'))
  })

  it('uses secret from config when provided', () => {
    const secret = 'a'.repeat(64)
    const sk = resolveClientKey({ pubkey: 'b'.repeat(64), relays: [], secret }, stateDir)
    expect(Buffer.from(sk).toString('hex')).toBe(secret)
  })

  it('generates and persists a new key when none cached', () => {
    const bunkerPk = 'c'.repeat(64)
    const sk = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    expect(sk).toHaveLength(32)

    const stored = readStateFile<Record<string, string>>('client-keys.json', stateDir)
    expect(stored[bunkerPk]).toBe(Buffer.from(sk).toString('hex'))
  })

  it('reuses cached key on second call', () => {
    const bunkerPk = 'd'.repeat(64)
    const sk1 = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    const sk2 = resolveClientKey({ pubkey: bunkerPk, relays: [] }, stateDir)
    expect(Buffer.from(sk1).toString('hex')).toBe(Buffer.from(sk2).toString('hex'))
  })

  it('stores separate keys per bunker pubkey', () => {
    const pk1 = 'e'.repeat(64)
    const pk2 = 'f'.repeat(64)
    const sk1 = resolveClientKey({ pubkey: pk1, relays: [] }, stateDir)
    const sk2 = resolveClientKey({ pubkey: pk2, relays: [] }, stateDir)
    expect(Buffer.from(sk1).toString('hex')).not.toBe(Buffer.from(sk2).toString('hex'))

    const stored = readStateFile<Record<string, string>>('client-keys.json', stateDir)
    expect(Object.keys(stored)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/bunker-context.test.ts`
Expected: FAIL — `resolveClientKey` is not exported

- [ ] **Step 3: Modify `src/bunker-context.ts`**

Add import at the top (after existing imports):

```typescript
import { readStateFile, writeStateFile } from './state.js'
```

Add the exported `resolveClientKey` function before the class:

```typescript
const CLIENT_KEYS_FILE = 'client-keys.json'

/** Resolve the client secret key: URI secret > cached > generate & persist. */
export function resolveClientKey(
  config: BunkerConfig,
  stateDir?: string,
): Uint8Array {
  if (config.secret) {
    return Buffer.from(config.secret, 'hex')
  }

  const cache = readStateFile<Record<string, string>>(CLIENT_KEYS_FILE, stateDir)
  if (cache[config.pubkey]) {
    return Buffer.from(cache[config.pubkey], 'hex')
  }

  const sk = generateSecretKey()
  cache[config.pubkey] = Buffer.from(sk).toString('hex')
  writeStateFile(CLIENT_KEYS_FILE, cache, stateDir)
  return sk
}
```

Update the `connect` method to use `resolveClientKey`:

Replace lines 57-60:
```typescript
  static async connect(uri: string, timeoutMs = 15_000): Promise<BunkerContext> {
    const config = parseBunkerUri(uri)
    const clientSk = config.secret
      ? Buffer.from(config.secret, 'hex')
      : generateSecretKey()
```

With:
```typescript
  static async connect(uri: string, timeoutMs = 15_000): Promise<BunkerContext> {
    const config = parseBunkerUri(uri)
    const clientSk = resolveClientKey(config)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/bunker-context.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Run existing bunker round-trip tests**

Run: `npx vitest run test/bunker-round-trip.test.ts`
Expected: All existing tests still PASS (no regression)

- [ ] **Step 6: Commit**

```bash
git add src/bunker-context.ts test/bunker-context.test.ts
git commit -m "feat: persist bunker client key across sessions"
```

---

### Task 3: Bunker approval persistence (`bunker.ts`)

**Files:**
- Modify: `src/bunker.ts:39-76`
- Modify: `test/bunker-round-trip.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/bunker-round-trip.test.ts`, inside the existing `describe` block, after the existing tests:

```typescript
  it('persists approved client pubkey after connect', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { readStateFile } = await import('../src/state.js')

    const stateDir = mkdtempSync(join(tmpdir(), 'bray-approval-test-'))

    // Start a separate bunker with stateDir
    const bunker2 = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      stateDir,
    })

    // Connect a client — this should auto-approve and persist
    const client = await BunkerContext.connect(bunker2.url)
    // Give the bunker a moment to process and persist
    await new Promise(r => setTimeout(r, 200))

    const approvals = readStateFile<Record<string, string[]>>('approved-clients.json', stateDir)
    expect(approvals[bunker2.pubkey]).toBeDefined()
    expect(approvals[bunker2.pubkey].length).toBeGreaterThanOrEqual(1)

    client.destroy()
    bunker2.close()
  }, 15_000)

  it('loads persisted approvals on startup', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { writeStateFile, readStateFile } = await import('../src/state.js')
    const { getPublicKey, generateSecretKey } = await import('nostr-tools/pure')

    const stateDir = mkdtempSync(join(tmpdir(), 'bray-load-test-'))

    // Pre-generate a client key and pre-approve it
    const clientSk = generateSecretKey()
    const clientPk = getPublicKey(clientSk)

    // Start bunker with authorized keys only — should reject unknown clients
    const bunker2 = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      authorizedKeys: ['0'.repeat(64)], // only a dummy key authorised
      stateDir,
    })

    // Write the client key as pre-approved for this bunker
    writeStateFile('approved-clients.json', {
      [bunker2.pubkey]: [clientPk],
    }, stateDir)

    // Restart bunker to pick up persisted approvals
    bunker2.close()
    const bunker3 = startBunker({
      ctx,
      relays: [relay.url],
      quiet: true,
      authorizedKeys: ['0'.repeat(64)],
      stateDir,
    })

    // Connect using a bunker URI with the pre-approved client secret
    const uri = `${bunker3.url}&secret=${Buffer.from(clientSk).toString('hex')}`
    const client = await BunkerContext.connect(uri)
    expect(client.activeNpub).toBe(ctx.activeNpub)

    client.destroy()
    bunker3.close()
  }, 15_000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/bunker-round-trip.test.ts`
Expected: FAIL — `stateDir` is not a known option on `BunkerOptions`

- [ ] **Step 3: Modify `src/bunker.ts`**

Add import at the top (after existing imports):

```typescript
import { readStateFile, writeStateFile } from './state.js'
```

Add `stateDir` to `BunkerOptions`:

```typescript
export interface BunkerOptions {
  ctx: IdentityContext
  relays: string[]
  authorizedKeys?: string[]
  bunkerKeyHex?: string
  quiet?: boolean
  heartwoodExtensions?: boolean
  stateDir?: string  // override state directory (for tests)
}
```

Reorder the top of `startBunker` so `bunkerPk` is available before building the authorised set. Replace lines 40-48 with:

```typescript
  const { ctx, relays, quiet } = opts
  const log = quiet ? () => {} : (...args: unknown[]) => console.error('[bunker]', ...args)

  // Bunker keypair — must be computed first so we can load persisted approvals
  const bunkerSk = opts.bunkerKeyHex
    ? Buffer.from(opts.bunkerKeyHex, 'hex')
    : generateSecretKey()
  const bunkerPk = getPublicKey(bunkerSk)
  const bunkerNpub = npubEncode(bunkerPk)

  // Authorised clients: CLI flag + persisted approvals
  const APPROVALS_FILE = 'approved-clients.json'
  const persisted = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
  const bunkerApprovals = persisted[bunkerPk] ?? []
  const authorizedKeys = new Set([
    ...(opts.authorizedKeys ?? []),
    ...bunkerApprovals,
  ])
```

This replaces the original lines 40-48 (which had `authorizedKeys` before `bunkerSk`/`bunkerPk` and a separate `log` declaration).

Inside `handleRequest`, after the authorization check passes (after line 75), add approval persistence for `connect` requests. Insert after `case 'connect':` but before the `result = 'ack'`:

Replace the connect case:

```typescript
      case 'connect':
        // Persist newly-approved client
        if (!bunkerApprovals.includes(clientPk)) {
          bunkerApprovals.push(clientPk)
          authorizedKeys.add(clientPk)
          const current = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
          current[bunkerPk] = bunkerApprovals
          writeStateFile(APPROVALS_FILE, current, opts.stateDir)
          log(`Approved and persisted client: ${clientPk.slice(0, 12)}...`)
        }
        result = 'ack'
        break
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/bunker-round-trip.test.ts`
Expected: All tests PASS (existing + 2 new)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All 1098+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/bunker.ts test/bunker-round-trip.test.ts
git commit -m "feat: persist bunker-approved client keys across restarts"
```
