/**
 * CLI smoke-test suite (Item 0)
 *
 * Exercises 40+ CLI verbs against a local in-memory relay. Every
 * mechanical refactor in Phase 1 must leave this suite green.
 *
 * Run after `npm run build`. The suite starts its own relay on an
 * ephemeral port; no external network required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { startRelay } from '../../src/serve.js'
import { startBunker } from '../../src/bunker.js'
import { IdentityContext } from '../../src/context.js'

const CLI = 'dist/cli.js'

// Deterministic test identity — never use in production
const TEST_NSEC = 'nsec1cxymst7yntfnvt4vkztk54q9muks6n77dn7qyhjpcvlxtkc6hy2s0364r8'

// Smallest valid secp256k1 scalar (for encode-nsec test)
const MIN_VALID_PRIVKEY_HEX = '0000000000000000000000000000000000000000000000000000000000000001'

let relayServer: ReturnType<typeof startRelay>
let localRelay: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the CLI and return trimmed stdout. Throws on non-zero exit. */
function cli(env: Record<string, string | undefined>, ...args: string[]): string {
  return execFileSync('node', [CLI, ...args], {
    env,
    encoding: 'utf-8',
    timeout: 15_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/**
 * Run the CLI with --json appended and parse stdout as JSON.
 * Do NOT use for commands that output plain strings via console.log
 * (encode-*, encrypt, decrypt, whoami, switch) — use cli() for those.
 */
function cliJson(env: Record<string, string | undefined>, ...args: string[]): unknown {
  return JSON.parse(cli(env, ...args, '--json'))
}

/**
 * Run the CLI with JSON piped to stdin and --json appended; parse stdout.
 * Used for publish-raw and future stdin-consuming commands.
 */
function cliJsonStdin(env: Record<string, string | undefined>, stdinData: string, ...args: string[]): unknown {
  return JSON.parse(
    execFileSync('node', [CLI, ...args, '--json'], {
      env,
      encoding: 'utf-8',
      timeout: 15_000,
      input: stdinData,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  )
}

/** Run the CLI and return stderr+stdout even if the process exits non-zero. */
function cliExpectFail(env: Record<string, string | undefined>, ...args: string[]): string {
  try {
    execFileSync('node', [CLI, ...args], {
      env,
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: 'pipe',
    })
    return ''
  } catch (e: any) {
    return `${e.stderr ?? ''}${e.stdout ?? ''}${e.message ?? ''}`
  }
}

// Base offline env — no relay required
const OFF: Record<string, string> = {
  NOSTR_SECRET_KEY: TEST_NSEC,
  PATH: process.env.PATH!,
}

// Online env pointing at the local relay (populated in beforeAll)
function online(): Record<string, string> {
  return { ...OFF, NOSTR_RELAYS: localRelay }
}

// ---------------------------------------------------------------------------
// Relay lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  relayServer = startRelay({ port: 0, quiet: true })
  localRelay = relayServer.url
})

afterAll(() => {
  relayServer?.close()
})

// ===========================================================================
// Offline commands
// ===========================================================================

describe('identity — offline', () => {
  it('whoami returns an npub', () => {
    expect(cli(OFF, 'whoami')).toMatch(/^npub1/)
  })

  it('whoami is deterministic', () => {
    expect(cli(OFF, 'whoami')).toBe(cli(OFF, 'whoami'))
  })

  it('create returns fresh npub + mnemonic', () => {
    const out = cliJson(OFF, 'create') as any
    expect(out.npub).toMatch(/^npub1/)
    expect(typeof out.mnemonic).toBe('string')
    expect(out.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
  })

  it('list returns array with master identity', () => {
    const out = cliJson(OFF, 'list') as any[]
    expect(Array.isArray(out)).toBe(true)
    expect(out[0].purpose).toBe('master')
    expect(out[0].npub).toMatch(/^npub1/)
  })

  it('derive returns child identity at default index', () => {
    // Pass explicit '0' so --json appended by cliJson lands at cmdArgs[3] not cmdArgs[2]
    const out = cliJson(OFF, 'derive', 'ci', '0') as any
    expect(out.npub).toMatch(/^npub1/)
    expect(out.purpose).toBe('ci')
    expect(out.index).toBe(0)
  })

  it('derive with explicit index', () => {
    const out = cliJson(OFF, 'derive', 'ci', '5') as any
    expect(out.index).toBe(5)
  })

  it('persona returns named persona', () => {
    // Pass explicit '0' for the same reason as derive above
    const out = cliJson(OFF, 'persona', 'smoketest', '0') as any
    expect(out.npub).toMatch(/^npub1/)
    expect(out.personaName).toBe('smoketest')
  })

  it('switch master returns master npub', () => {
    const whoami = cli(OFF, 'whoami')
    const switched = cli(OFF, 'switch', 'master')
    expect(switched).toBe(whoami)
  })
})

describe('encode / decode — offline', () => {
  it('decode npub returns type + 64-char hex data', () => {
    const npub = cli(OFF, 'whoami')
    const out = cliJson(OFF, 'decode', npub) as any
    expect(out.type).toBe('npub')
    expect(typeof out.data).toBe('string')
    expect((out.data as string).length).toBe(64)
  })

  it('encode-npub roundtrip: hex → npub → decode → same hex', () => {
    const npub = cli(OFF, 'whoami')
    const hex = (cliJson(OFF, 'decode', npub) as any).data as string
    const reEncoded = cli(OFF, 'encode-npub', hex)
    expect(reEncoded).toBe(npub)
  })

  it('encode-note produces note1 prefix', () => {
    const note = cli(OFF, 'encode-note', '0'.repeat(64))
    expect(note).toMatch(/^note1/)
  })

  it('decode note returns event id hex', () => {
    const hex = '0'.repeat(64)
    const note = cli(OFF, 'encode-note', hex)
    const out = cliJson(OFF, 'decode', note) as any
    expect(out.type).toBe('note')
    expect(out.data).toBe(hex)
  })

  it('encode-nprofile produces nprofile1 prefix', () => {
    const npub = cli(OFF, 'whoami')
    const hex = (cliJson(OFF, 'decode', npub) as any).data as string
    const nprofile = cli(OFF, 'encode-nprofile', hex)
    expect(nprofile).toMatch(/^nprofile1/)
  })

  it('encode-nevent produces nevent1 prefix', () => {
    const nevent = cli(OFF, 'encode-nevent', '0'.repeat(64))
    expect(nevent).toMatch(/^nevent1/)
  })

  it('encode-nsec produces nsec1 prefix', () => {
    const nsec = cli(OFF, 'encode-nsec', MIN_VALID_PRIVKEY_HEX)
    expect(nsec).toMatch(/^nsec1/)
  })
})

describe('key operations — offline', () => {
  it('key-public derives pubkey matching whoami', () => {
    const out = cliJson(OFF, 'key-public', TEST_NSEC) as any
    expect(out.npub).toMatch(/^npub1/)
    expect(out.pubkeyHex.length).toBe(64)
    expect(out.npub).toBe(cli(OFF, 'whoami'))
  })

  it('key-encrypt returns ncryptsec + pubkey', () => {
    const out = cliJson(OFF, 'key-encrypt', TEST_NSEC, 'smokepassword') as any
    expect(out.ncryptsec).toMatch(/^ncryptsec1/)
    expect(out.pubkeyHex.length).toBe(64)
    expect(out.npub).toMatch(/^npub1/)
  })

  it('key-encrypt + key-decrypt roundtrip', () => {
    const encrypted = cliJson(OFF, 'key-encrypt', TEST_NSEC, 'roundtrippass') as any
    const decrypted = cliJson(OFF, 'key-decrypt', encrypted.ncryptsec, 'roundtrippass') as any
    expect(decrypted.npub).toBe(encrypted.npub)
    expect(decrypted.pubkeyHex).toBe(encrypted.pubkeyHex)
  })

  it('key-decrypt with wrong password exits non-zero', () => {
    const encrypted = cliJson(OFF, 'key-encrypt', TEST_NSEC, 'correct') as any
    const err = cliExpectFail(OFF, 'key-decrypt', encrypted.ncryptsec, 'wrong')
    expect(err.length).toBeGreaterThan(0)
  })
})

describe('NIP-44 encrypt / decrypt — offline', () => {
  it('encrypt + decrypt roundtrip (self-encrypt)', () => {
    const pubkeyHex = (cliJson(OFF, 'key-public', TEST_NSEC) as any).pubkeyHex
    const ciphertext = cli(OFF, 'encrypt', pubkeyHex, 'hello smoke test')
    expect(ciphertext.length).toBeGreaterThan(10)
    const plaintext = cli(OFF, 'decrypt', pubkeyHex, ciphertext)
    expect(plaintext).toBe('hello smoke test')
  })
})

describe('spoken token — offline', () => {
  it('spoken-challenge returns a string token', () => {
    // Secret must be valid hex; 'a'.repeat(64) = 32 hex bytes
    const out = cliJson(OFF, 'spoken-challenge', 'a'.repeat(64), 'smoke-ctx', '1') as any
    expect(typeof out.token).toBe('string')
    expect(out.token.length).toBeGreaterThan(0)
  })

  it('spoken-verify roundtrip returns valid: true', () => {
    const secret = 'b'.repeat(64) // valid hex
    const ch = cliJson(OFF, 'spoken-challenge', secret, 'round-ctx', '7') as any
    const v = cliJson(OFF, 'spoken-verify', secret, 'round-ctx', '7', ch.token) as any
    expect(v.valid).toBe(true)
  })

  it('spoken-verify wrong token returns valid: false', () => {
    const v = cliJson(OFF, 'spoken-verify', 'c'.repeat(64), 'ctx', '1', 'wrongtoken') as any
    expect(v.valid).toBe(false)
  })
})

describe('utility — offline', () => {
  it('verify flags invalid event', () => {
    const bad = JSON.stringify({ kind: 1, pubkey: '0'.repeat(64), id: '0'.repeat(64), sig: '0'.repeat(128), created_at: 1, tags: [], content: '' })
    const out = cliJson(OFF, 'verify', bad) as any
    expect(out.valid).toBe(false)
    expect(Array.isArray(out.errors)).toBe(true)
    expect(out.errors.length).toBeGreaterThan(0)
  })

  it('filter matches event against kinds filter', () => {
    const event = JSON.stringify({ kind: 1, pubkey: '0'.repeat(64), id: '0'.repeat(64), sig: '0'.repeat(128), created_at: 1, tags: [], content: '' })
    const out = cliJson(OFF, 'filter', event, JSON.stringify({ kinds: [1] })) as any
    expect(out.matches).toBe(true)
  })

  it('filter rejects non-matching kind', () => {
    const event = JSON.stringify({ kind: 7, pubkey: '0'.repeat(64), id: '0'.repeat(64), sig: '0'.repeat(128), created_at: 1, tags: [], content: '' })
    const out = cliJson(OFF, 'filter', event, JSON.stringify({ kinds: [1] })) as any
    expect(out.matches).toBe(false)
  })

  it('zap-decode parses lnbc prefix to msats', () => {
    const out = cliJson(OFF, 'zap-decode', 'lnbc10u1test') as any
    expect(out.amountMsats).toBe(1_000_000)
  })
})

describe('trust-verify — offline', () => {
  it('trust-verify on a minimal event returns a valid field', () => {
    const event = JSON.stringify({ kind: 30818, pubkey: '0'.repeat(64), id: '0'.repeat(64), sig: '0'.repeat(128), created_at: 1, tags: [], content: '' })
    const out = cliJson(OFF, 'trust-verify', event) as any
    expect(typeof out.valid).toBe('boolean')
  })
})

describe('safety — offline', () => {
  it('safety-configure returns configured:true + npub', () => {
    const out = cliJson(OFF, 'safety-configure', 'emergency') as any
    expect(out.configured).toBe(true)
    expect(out.npub).toMatch(/^npub1/)
  })

  it('safety-activate returns npub', () => {
    const out = cliJson(OFF, 'safety-activate') as any
    expect(out.npub).toMatch(/^npub1/)
  })
})

describe('error handling', () => {
  it('unknown command exits non-zero with helpful message', () => {
    // Needs NOSTR_RELAYS so NIP-65 resolves before the error is thrown
    const err = cliExpectFail(online(), 'not-a-real-command')
    expect(err).toContain('Unknown command')
  })

  it('missing required arg prints Usage', () => {
    const err = cliExpectFail(OFF, 'derive')
    expect(err).toContain('Usage')
  })

  it('--help shows usage without NOSTR_SECRET_KEY', () => {
    const out = execFileSync('node', [CLI, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { PATH: process.env.PATH! },
    })
    expect(out).toContain('nostr-bray')
    expect(out).toContain('whoami')
    expect(out).toContain('NOSTR_SECRET_KEY')
  })

  it('--help lists all command groups', () => {
    const out = execFileSync('node', [CLI, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: { PATH: process.env.PATH! },
    })
    expect(out).toContain('Identity:')
    expect(out).toContain('Social:')
    expect(out).toContain('Trust:')
    expect(out).toContain('Relay:')
    expect(out).toContain('Zap:')
    expect(out).toContain('Safety:')
    expect(out).toContain('Utility:')
  })
})

// ===========================================================================
// Online commands — local relay
// ===========================================================================

describe('relay commands — local relay', { timeout: 20_000 }, () => {
  it('relay-list returns read/write arrays', () => {
    const out = cliJson(online(), 'relay-list') as any
    expect(Array.isArray(out.read)).toBe(true)
    expect(Array.isArray(out.write)).toBe(true)
  })

  it('relay-list includes the configured relay', () => {
    const out = cliJson(online(), 'relay-list') as any
    const all = [...out.read, ...out.write]
    expect(all.some((r: string) => r === localRelay)).toBe(true)
  })

  it('relay-info rejects private-network URLs (security guard)', () => {
    // relay-info blocks localhost/127.x by design — this verifies the verb is wired
    // and the guard fires. Public relay testing happens manually / in integration CI.
    const err = cliExpectFail(online(), 'relay-info', localRelay)
    expect(err).toContain('private network')
  })

  it('count returns numeric count', () => {
    const out = cliJson(online(), 'count', '--kinds', '1') as any
    expect(typeof out.count).toBe('number')
    expect(out.count).toBeGreaterThanOrEqual(0)
  })
})

describe('social commands — local relay', { timeout: 30_000 }, () => {
  let authorPubkeyHex: string
  let postEventId: string

  beforeAll(() => {
    authorPubkeyHex = (cliJson(OFF, 'key-public', TEST_NSEC) as any).pubkeyHex
    // Pre-publish one event to use as target for reply/react/repost/delete
    const result = cliJson(online(), 'post', 'smoke-suite anchor event') as any
    postEventId = result.event.id
  })

  it('post returns event with hex id and kind 1', () => {
    const out = cliJson(online(), 'post', 'smoke-suite text note') as any
    expect(out.event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.event.kind).toBe(1)
    expect(out.publish.success).toBe(true)
  })

  it('reply creates kind 1 with e-tag referencing parent', () => {
    const out = cliJson(online(), 'reply', postEventId, authorPubkeyHex, 'smoke reply text') as any
    expect(out.event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.event.kind).toBe(1)
    const eTags = out.event.tags.filter((t: string[]) => t[0] === 'e')
    expect(eTags.length).toBeGreaterThan(0)
    expect(eTags[0][1]).toBe(postEventId)
  })

  it('react creates kind 7 event', () => {
    const out = cliJson(online(), 'react', postEventId, authorPubkeyHex, '+') as any
    expect(out.event.kind).toBe(7)
    expect(out.event.content).toBe('+')
    expect(out.publish.success).toBe(true)
  })

  it('repost creates kind 6 event', () => {
    const out = cliJson(online(), 'repost', postEventId, authorPubkeyHex) as any
    expect(out.event.kind).toBe(6)
    expect(out.publish.success).toBe(true)
  })

  it('delete creates kind 5 deletion event', () => {
    const toDelete = cliJson(online(), 'post', 'to-be-deleted smoke note') as any
    const del = cliJson(online(), 'delete', toDelete.event.id) as any
    expect(del.event.kind).toBe(5)
    expect(del.publish.success).toBe(true)
  })

  it('profile returns object (empty is valid for unknown pubkey)', () => {
    const out = cliJson(online(), 'profile', authorPubkeyHex) as any
    expect(typeof out === 'object').toBe(true)
  })

  it('contacts returns array (empty for new identity)', () => {
    const out = cliJson(online(), 'contacts', authorPubkeyHex) as any
    expect(Array.isArray(out)).toBe(true)
  })

  it('dm sends NIP-17 gift-wrap to self', () => {
    const out = cliJson(online(), 'dm', authorPubkeyHex, 'smoke dm to self') as any
    expect(out.protocol).toBe('nip17')
    expect(typeof out.publish === 'object').toBe(true)
  })

  it('follow publishes kind 3 contact event', () => {
    const targetHex = '0'.repeat(63) + '1'
    const out = cliJson(online(), 'follow', targetHex) as any
    // Returns PostResult or ContactGuardWarning
    expect(out !== null && typeof out === 'object').toBe(true)
  })

  it('unfollow publishes updated kind 3 contact event', () => {
    const targetHex = '0'.repeat(63) + '1'
    // follow first so there is something to unfollow
    cliJson(online(), 'follow', targetHex)
    const out = cliJson(online(), 'unfollow', targetHex) as any
    expect(out !== null && typeof out === 'object').toBe(true)
  })
})

describe('trust commands — local relay', { timeout: 20_000 }, () => {
  it('trust-read returns result (may be empty)', () => {
    const out = cliJson(online(), 'trust-read') as any
    expect(out !== undefined).toBe(true)
  })

  it('claim publishes a trust attestation event', () => {
    const authorPubkeyHex = (cliJson(OFF, 'key-public', TEST_NSEC) as any).pubkeyHex
    const out = cliJson(online(), 'claim', 'endorsement', '--subject', authorPubkeyHex) as any
    // Returns { event, publish } from handleTrustAttest
    expect(out !== null && typeof out === 'object').toBe(true)
  })
})

describe('NIP publishing — local relay', { timeout: 20_000 }, () => {
  it('nip-publish creates kind 30817 and returns event id', () => {
    const out = cliJson(online(), 'nip-publish', 'smoke-item0', 'Smoke NIP', 'Content for item-0 smoke test') as any
    expect(out.event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.event.kind).toBe(30817)
    expect(out.publish.success).toBe(true)
  })

  it('nip-read returns array', () => {
    const out = cliJson(online(), 'nip-read') as any
    expect(Array.isArray(out)).toBe(true)
  })
})

describe('publish-raw — local relay', { timeout: 20_000 }, () => {
  it('signs and broadcasts an unsigned event from stdin', () => {
    const unsigned = { kind: 1, content: 'publish-raw smoke test', tags: [], created_at: Math.floor(Date.now() / 1000) }
    const out = cliJsonStdin(online(), JSON.stringify(unsigned), 'publish-raw') as any
    expect(out.event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.event.kind).toBe(1)
    expect(out.event.content).toBe('publish-raw smoke test')
    expect(out.publish.success).toBe(true)
    expect(out.signed).toBe(true)
  })

  it('broadcasts a pre-signed event with --no-sign', () => {
    // First get a real signed event from post, then rebroadcast it via publish-raw --no-sign
    const posted = cliJson(online(), 'post', 'publish-raw no-sign source') as any
    const signedEvent = posted.event
    const out = cliJsonStdin(online(), JSON.stringify(signedEvent), 'publish-raw', '--no-sign') as any
    expect(out.event.id).toBe(signedEvent.id)
    expect(out.signed).toBe(false)
    expect(out.publish.success).toBe(true)
  })

  it('respects --relay flag (per-command relay override)', () => {
    const unsigned = { kind: 1, content: 'publish-raw relay-flag test', tags: [], created_at: Math.floor(Date.now() / 1000) }
    const out = cliJsonStdin(online(), JSON.stringify(unsigned), 'publish-raw', '--relay', localRelay) as any
    expect(out.event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.publish.success).toBe(true)
  })

  it('signs partial event (missing created_at) using defaults', () => {
    // created_at will be set to now by the handler
    const partial = { kind: 1, content: 'publish-raw partial', tags: [] }
    const out = cliJsonStdin(online(), JSON.stringify(partial), 'publish-raw') as any
    expect(out.event.kind).toBe(1)
    expect(out.event.created_at).toBeGreaterThan(0)
    expect(out.signed).toBe(true)
  })
})

describe('bunker sign — local relay', { timeout: 30_000 }, () => {
  // Bunker needs a real connectable relay URL. The smoke suite's outer relay
  // uses port 0 and returns 'ws://localhost:0' (the pre-bind value), which is
  // not a valid connection target. Use a dedicated fixed-port relay instead.
  let bunkerRelayServer: ReturnType<typeof startRelay>
  let bunkerRelayUrl: string
  let bunkerInstance: ReturnType<typeof startBunker>
  let bunkerCtx: InstanceType<typeof IdentityContext>

  beforeAll(async () => {
    bunkerRelayServer = startRelay({ port: 19747, quiet: true })
    bunkerRelayUrl = bunkerRelayServer.url  // ws://localhost:19747
    bunkerCtx = new IdentityContext(TEST_NSEC, 'nsec')
    bunkerInstance = startBunker({ ctx: bunkerCtx, relays: [bunkerRelayUrl], quiet: true })
    // Give the relay + bunker time to establish the subscription
    await new Promise(resolve => setTimeout(resolve, 400))
  })

  afterAll(() => {
    bunkerInstance?.close()
    bunkerCtx?.destroy()
    bunkerRelayServer?.close()
  })

  // Must use spawn (async) not execFileSync (sync): execFileSync blocks the
  // parent event loop, which prevents the relay server (also in this process)
  // from processing the WebSocket upgrade from the CLI subprocess.
  it('signs a template event via stdin and returns a valid Nostr event', async () => {
    const template = { kind: 1, content: 'bunker sign smoke test', tags: [], created_at: Math.floor(Date.now() / 1000) }
    const out = await new Promise<any>((resolve, reject) => {
      const proc = spawn('node', [CLI, 'bunker', 'sign'], {
        env: { PATH: process.env.PATH!, BUNKER_URI: bunkerInstance.url },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      proc.stdin.write(JSON.stringify(template))
      proc.stdin.end()
      let stdout = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      const timer = setTimeout(() => { proc.kill(); reject(new Error('bunker sign timed out')) }, 20_000)
      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        if (code === 0) resolve(JSON.parse(stdout.trim()))
        else reject(new Error(`bunker sign exited ${code}`))
      })
    })
    expect(out.id).toMatch(/^[0-9a-f]{64}$/)
    expect(out.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(out.kind).toBe(1)
    expect(out.content).toBe('bunker sign smoke test')
  })

  it('fails gracefully when BUNKER_URI is missing', () => {
    const err = cliExpectFail({ PATH: process.env.PATH! }, 'bunker', 'sign')
    expect(err).toContain('missing bunker URI')
  })
})
