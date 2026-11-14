import type { Event as NostrEvent, EventTemplate, Filter } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import type { PublishResult, RelaySet } from './types.js'
import { validatePublicUrl, validateRelayScheme } from './validation.js'
import { brayFetch } from './http-client.js'
import { isConnectionFailure, setAutomaticAuth, type ChallengeSigner } from './nostr-tools-guards.js'
import { errorMessage } from './error-message.js'

/**
 * Signs a NIP-42 kind 22242 template produced by the relay layer.
 *
 * The relay builds the template (it owns the `relay` and `challenge` tags);
 * this only has to sign it.
 */
export type AuthSigner = (evt: EventTemplate) => Promise<NostrEvent>

/**
 * How aggressively to answer NIP-42 AUTH challenges.
 *
 * - `off` — never authenticate. Queries and publishes to auth-gated relays fail.
 * - `on-demand` — authenticate only after a relay rejects with `auth-required:`,
 *   then retry the operation once.
 * - `eager` — additionally answer the AUTH challenge as soon as it arrives,
 *   before any operation has been rejected.
 *
 * Defaults to `off`. Authenticating proves control of the active pubkey to the
 * relay, so it is opt-in rather than automatic: for a tool with personas, duress
 * identities and a Tor policy, silently identifying yourself to every relay that
 * asks is not a safe default.
 */
export type AuthMode = 'off' | 'on-demand' | 'eager'

// 512 KiB cap on any inbound relay frame. Protects against malicious relays
// pushing 100 MB EVENTs that would exhaust memory (ws library defaults to
// 100 MB maxPayload, which is far more than any legitimate Nostr event).
const WS_MAX_PAYLOAD = 512 * 1024

export interface Subscription {
  close(): void
}

/** Why one relay ended a subscription: its CLOSED reason, or the connection's fate. */
export interface SubscriptionClose {
  url: string
  reason: string
}

/**
 * Whether a relay ended a REQ in the ordinary way: at EOSE (nostr-tools closes
 * a one-shot query itself then) or because the caller closed it. Anything else
 * is the relay's CLOSED reason or a connection failure.
 */
export function isNormalRequestEnd(reason: string): boolean {
  return reason === 'closed automatically on eose' || reason === 'closed by caller'
}

/** One relay's answer to a NIP-45 COUNT: its count, or why there is none. */
export interface RelayCount {
  url: string
  count?: number
  /** The relay marked its count approximate. */
  approximate?: boolean
  /** The relay's CLOSED reason (auth failures explained), a timeout, or a connection failure. */
  error?: string
}


/** Settle with `p`, or reject with `message` after `ms`. */
function within<T>(ms: number, p: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
  ])
}

/** Params threaded through to nostr-tools: deadlines plus NIP-42 auth retry. */
export interface PoolParams {
  maxWait?: number
  abort?: AbortSignal
  /** Lets nostr-tools answer `auth-required:` and retry the operation once. */
  onauth?: AuthSigner
}

export interface PoolLike {
  publish(relays: string[], event: NostrEvent, params?: PoolParams): Promise<string>[]
  querySync(relays: string[], filter: Filter, params?: PoolParams): Promise<NostrEvent[]>
  subscribeMany?(relays: string[], filter: Filter, handlers: { onevent(event: NostrEvent): void; oneose?(): void; onclose?(reasons: SubscriptionClose[]): void } & Pick<PoolParams, 'onauth'>): Subscription
  /** A REQ that closes itself at EOSE, reporting each relay's reason. Absent on injected test doubles. */
  subscribeEose?(relays: string[], filter: Filter, handlers: { onevent(event: NostrEvent): void; onclose(reasons: SubscriptionClose[]): void } & PoolParams): Subscription
  ensureRelay?(url: string, params?: { connectionTimeout?: number; abort?: AbortSignal }): Promise<AbstractRelay>
  /** Install the eager AUTH-challenge responder. Absent on injected test doubles. */
  setAutomaticAuth?(signer: ((relayUrl: string) => AuthSigner | null) | undefined): void
  /**
   * Consulted before each use of a relay connection, with nostr-tools'
   * normalised URL and whether a connection is open: true closes the open one
   * so the use starts on a fresh connection. Absent on injected test doubles.
   */
  setReuseCheck?(check: ((url: string, open: boolean) => boolean) | undefined): void
  /** Close and forget one relay's connection. Absent on injected test doubles. */
  forget?(url: string): void
  destroy(): void
}

export interface ReconcileDirectResult {
  localOnlyIds: string[]
  remoteOnlyIds: string[]
  localOnlyCount: number
  remoteOnlyCount: number
  truncated: boolean
}

export class Nip77UnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Nip77UnavailableError'
  }
}

/**
 * Summarise a publish attempt into the two boolean flags on {@link PublishResult}.
 *
 * `success` is true when the event reached the network as a majority: at least
 * one relay accepted AND at least 50% of attempted relays accepted. This is the
 * default "did my publish work" signal. Paywalled, whitelisted, or transient
 * failures routinely leave some relays in the rejected list, so requiring every
 * relay to accept produces far too many false negatives.
 *
 * `allAccepted` preserves the strict "every attempted relay accepted" semantic
 * for callers that genuinely need it (e.g. high-assurance publishing to a
 * small curated list of private relays).
 *
 * Zero attempted relays is treated as failure on both flags.
 */
export function summarisePublish(
  acceptedCount: number,
  attempted: number,
): { success: boolean; allAccepted: boolean } {
  if (attempted <= 0) return { success: false, allAccepted: false }
  return {
    success: acceptedCount >= 1 && acceptedCount * 2 >= attempted,
    allAccepted: acceptedCount === attempted,
  }
}

export interface RelayPoolConfig {
  torProxy?: string
  allowClearnet: boolean
  defaultRelays: string[]
  /**
   * Skip the private-network validatePublicUrl check. Used only for local
   * development (in-memory test relay at ws://localhost:<port>, docker-
   * networked relays, etc). Gated by BRAY_ALLOW_PRIVATE_RELAYS=1.
   */
  allowPrivateRelays?: boolean
  /** NIP-42 AUTH policy. Defaults to 'off'. See {@link AuthMode}. */
  authMode?: AuthMode
}

/** Initialise WebSocket and create a real SimplePool — lazy-loaded to avoid side effects at import */
async function createRealPool(torProxy?: string): Promise<PoolLike> {
  const { useWebSocketImplementation, SimplePool } = await import('nostr-tools/pool')
  const { webSocketFor } = await import('./ws-safe.js')
  // With torProxy, every connection goes through the SOCKS5h proxy, so DNS
  // happens at the proxy. The pool gets its class directly, so a later
  // useWebSocketImplementation call elsewhere cannot change it.
  const WebSocketImpl = webSocketFor(torProxy, { maxPayload: WS_MAX_PAYLOAD })
  useWebSocketImplementation(WebSocketImpl)

  const pool = new SimplePool({ websocketImplementation: WebSocketImpl } as ConstructorParameters<typeof SimplePool>[0])
  const { normalizeURL } = await import('nostr-tools/utils')
  // nostr-tools reaches every relay through ensureRelay, so this is where a
  // connection can be refused reuse. The relay map is protected in its types.
  const relayMap = (pool as unknown as { relays: Map<string, AbstractRelay> }).relays
  const ensureRelay = pool.ensureRelay.bind(pool)
  let reuseCheck: ((url: string, open: boolean) => boolean) | undefined
  pool.ensureRelay = ((url: string, params?: Parameters<typeof ensureRelay>[1]) => {
    const key = normalizeURL(url)
    if (reuseCheck?.(key, relayMap.has(key))) pool.close([key])
    return ensureRelay(url, params)
  }) as typeof pool.ensureRelay
  return {
    // `onauth` is spread straight through to the subscription params by
    // querySync/subscribeEose, so it works despite not being in querySync's
    // narrowed parameter type.
    publish: (relays, event, params) => pool.publish(relays, event, params as any),
    querySync: (relays, filter, params) => pool.querySync(relays, filter, params as any),
    subscribeMany: (relays, filters, handlers) => pool.subscribeMany(relays, filters, handlers as any),
    subscribeEose: (relays, filter, handlers) => pool.subscribeEose(relays, filter, handlers as any),
    ensureRelay: (url, params) => pool.ensureRelay(url, params),
    setAutomaticAuth: signerFor => setAutomaticAuth(pool, signerFor as ((url: string) => ChallengeSigner | null) | undefined),
    setReuseCheck: check => { reuseCheck = check },
    forget: url => pool.close([normalizeURL(url)]),
    destroy: () => pool.destroy(),
  } satisfies PoolLike
}

/** An AUTH step that did not finish in time. */
class AuthTimeout extends Error {
  constructor(step: 'signature' | 'relay OK', ms: number) {
    super(step === 'signature'
      ? `AUTH timed out: no signature within ${ms} ms (the signer did not answer; if it is a remote signer, approve the request there)`
      : `AUTH timed out: the relay did not answer the signed AUTH within ${ms} ms`)
  }
}

export class RelayPool {
  private pool: PoolLike | undefined
  private poolReady: Promise<PoolLike>
  private relaySets = new Map<string, RelaySet>()
  private writeQueue = new Map<string, NostrEvent[]>()
  private relaySelfCache = new Map<string, { pubkey: string; expiresAt: number }>()
  private relaySelfPending = new Map<string, Promise<string>>()
  private defaults: RelaySet
  private torProxy?: string
  private allowClearnet: boolean
  private allowPrivateRelays: boolean
  private authMode: AuthMode
  private authSigner: AuthSigner | undefined
  /** Relays we have signed an AUTH event for, for diagnostics. */
  private authedRelays = new Set<string>()
  /** The active identity's pubkey (hex), from the signing context. */
  #currentPubkey: (() => string) | undefined
  /**
   * For each relay connection (nostr-tools' normalised URL): the identity that
   * last used it, and the one whose AUTH event it has seen (accepted or not, the
   * relay has seen the key). See #reuse.
   */
  #connectionOwners = new Map<string, { usedBy?: string; authedBy?: string }>()

  constructor(config: RelayPoolConfig, injectedPool?: PoolLike) {
    this.torProxy = config.torProxy
    this.allowClearnet = config.allowClearnet
    this.allowPrivateRelays = config.allowPrivateRelays ?? false
    this.authMode = config.authMode ?? 'off'

    // Validate default relays up-front with the same rules reconfigure applies.
    // Without this, a NOSTR_RELAYS env var or config file containing
    // ws://127.0.0.1 would populate this.defaults and be returned by
    // getRelays() for any npub without an explicit relay set, bypassing the
    // per-identity checks.
    for (const url of config.defaultRelays) {
      if (!/^wss?:\/\//i.test(url) || url.length > 512) {
        throw new Error(`Invalid default relay URL: ${url.slice(0, 128)}`)
      }
      validateRelayScheme(url, this.allowPrivateRelays)
      if (!this.allowPrivateRelays && !this.isOnion(url)) {
        validatePublicUrl(url)
      }
    }

    // Validate Tor/clearnet policy on default relays
    if (config.torProxy && !config.allowClearnet) {
      const clearnet = config.defaultRelays.filter(r => !this.isOnion(r))
      if (clearnet.length > 0) {
        throw new Error(
          `Clearnet relays not allowed with Tor proxy (set allowClearnet to override): ${clearnet.join(', ')}`
        )
      }
    }

    this.defaults = {
      read: [...config.defaultRelays],
      write: [...config.defaultRelays],
    }

    if (injectedPool) {
      this.pool = injectedPool
      this.poolReady = Promise.resolve(injectedPool)
    } else {
      this.poolReady = createRealPool(config.torProxy).then(p => { this.pool = p; return p })
    }
    // Registered before any caller can await poolReady, so no use goes unchecked.
    void this.poolReady.then(p => p.setReuseCheck?.((url, open) => this.#reuse(url, open)))
  }

  /** The active identity's pubkey, or undefined when it is not known (yet). */
  #activePubkey(): string | undefined {
    try {
      return this.#currentPubkey?.()
    } catch {
      // A bunker context throws until its key is resolved.
      return undefined
    }
  }

  /**
   * Whether the open connection to `url` must be replaced before the active
   * identity uses it, so one connection never carries two identities.
   *
   * A NIP-42 AUTH ties a connection to a key, so a relay that has seen one
   * identity's AUTH on a connection could link it to the next identity's
   * traffic there. That connection is replaced in every auth mode. With AUTH on
   * (on-demand or eager), any connection another identity used is replaced
   * too, since the next AUTH on it would link the two. With AUTH off and no AUTH
   * sent, a connection is kept across a switch. The same IP and timing remain
   * either way: this removes the AUTH link only.
   */
  #reuse(url: string, open: boolean): boolean {
    const current = this.#activePubkey()
    if (current === undefined) return false
    const owner = open ? this.#connectionOwners.get(url) : undefined
    const sawOtherAuth = owner?.authedBy !== undefined && owner.authedBy !== current
    const usedByOther = this.authMode !== 'off' && owner?.usedBy !== undefined && owner.usedBy !== current
    if (sawOtherAuth || usedByOther) {
      console.error(`[bray] new connection to ${url} for the active identity: the open one ${sawOtherAuth ? 'authenticated as' : 'was used by'} another identity`)
      this.#connectionOwners.set(url, { usedBy: current })
      return true
    }
    this.#connectionOwners.set(url, { ...owner, usedBy: current })
    return false
  }

  /** Store relay set for an identity and flush any queued writes */
  reconfigure(npub: string, relays: RelaySet): void {
    const allUrls = [...relays.read, ...relays.write]

    // Reject private/malformed URLs regardless of Tor mode — closes SSRF
    // vectors where callers (NIP-65 events, relay-add, workflow tools) could
    // inject a loopback or cloud-metadata URL when Tor is off. When
    // allowPrivateRelays is explicitly set (BRAY_ALLOW_PRIVATE_RELAYS=1),
    // only the scheme/length guard runs — used for local development against
    // the in-memory test relay.
    for (const url of allUrls) {
      if (!/^wss?:\/\//i.test(url) || url.length > 512) {
        throw new Error(`Invalid relay URL: ${url.slice(0, 128)}`)
      }
      // Block plaintext ws:// to clearnet — onion services and local dev are exempt.
      validateRelayScheme(url, this.allowPrivateRelays)
      // .onion hosts bypass validatePublicUrl (they don't resolve in DNS and
      // cannot be private-network aliases); everything else must pass.
      if (!this.allowPrivateRelays && !this.isOnion(url)) {
        validatePublicUrl(url)
      }
    }

    // Tor policy: when Tor is required (no allowClearnet), only .onion allowed.
    if (this.torProxy && !this.allowClearnet) {
      const clearnet = allUrls.filter(r => !this.isOnion(r))
      if (clearnet.length > 0) {
        throw new Error(`Clearnet relays not allowed with Tor proxy: ${clearnet.join(', ')}`)
      }
    }
    this.relaySets.set(npub, relays)
    void this.flushQueue(npub)
  }

  /**
   * Whether private-network relay URLs are accepted (BRAY_ALLOW_PRIVATE_RELAYS=1),
   * so handlers that validate a URL before reaching the pool apply the same rule.
   */
  allowsPrivateRelays(): boolean {
    return this.allowPrivateRelays
  }

  /** Get relay set for an identity, falling back to defaults */
  getRelays(npub: string): RelaySet {
    return this.relaySets.get(npub) ?? this.defaults
  }

  /**
   * Supply the signer used to answer NIP-42 AUTH challenges.
   *
   * Called once the identity context exists, which is after the pool is
   * constructed. Passing `undefined` disables authentication again (used when
   * switching identity, so a challenge is never answered with a stale key).
   *
   * `currentPubkey` returns the active identity's pubkey (hex). With it, a
   * relay connection is not reused across an identity switch when that could
   * tie the two identities together (see #reuse); without it, connections are
   * reused as before.
   */
  setAuthSigner(signer: AuthSigner | undefined, currentPubkey?: () => string): void {
    this.authSigner = signer
    this.#currentPubkey = currentPubkey
    this.authedRelays.clear()
    void this.#applyEagerAuth()
  }

  /** Current NIP-42 policy. */
  getAuthMode(): AuthMode {
    return this.authMode
  }

  /** Change the NIP-42 policy at runtime. */
  setAuthMode(mode: AuthMode): void {
    this.authMode = mode
    void this.#applyEagerAuth()
  }

  /** Relay URLs this pool has authenticated to during its lifetime. */
  getAuthedRelays(): string[] {
    return [...this.authedRelays]
  }

  /**
   * In `eager` mode, install a responder that answers the AUTH challenge as
   * soon as a relay sends one, rather than waiting for a rejection.
   */
  async #applyEagerAuth(): Promise<void> {
    const pool = await this.poolReady
    if (!pool.setAutomaticAuth) return
    if (this.authMode !== 'eager' || !this.authSigner) {
      pool.setAutomaticAuth(undefined)
      return
    }
    pool.setAutomaticAuth(() => this.#eagerSignAuth)
  }

  /**
   * The eager responder's signer. It signs exactly as {@link #signAuth} does,
   * but is a separate function so the pool can tell nostr-tools' automatic
   * answer to a challenge apart from an operation's own on-demand AUTH.
   */
  #eagerSignAuth = (evt: EventTemplate): Promise<NostrEvent> => this.#signAuth(evt)

  /**
   * Bound signer handed to nostr-tools. Records which relays were authenticated
   * to so callers can tell whether a query identified them.
   */
  #signAuth = async (evt: EventTemplate): Promise<NostrEvent> => {
    if (!this.authSigner) throw new Error('NIP-42 AUTH requested but no signer is configured')
    const relayTag = evt.tags.find(t => t[0] === 'relay')?.[1]
    const signed = await this.authSigner(evt)
    if (relayTag) {
      this.authedRelays.add(relayTag)
      // nostr-tools names the relay by the same normalised URL as its map.
      this.#connectionOwners.set(relayTag, { ...this.#connectionOwners.get(relayTag), authedBy: signed.pubkey })
    }
    return signed
  }

  /**
   * Auth params for a single operation. Returns `{}` when authentication is
   * off or unavailable, so nostr-tools takes its non-auth path unchanged.
   */
  #authParams(): Pick<PoolParams, 'onauth'> {
    if (this.authMode === 'off' || !this.authSigner) return {}
    return { onauth: this.#signAuth }
  }

  /**
   * Explain an `auth-required:` failure in terms of what the caller can do
   * about it, rather than leaving a bare relay error.
   */
  #annotateAuthError(message: string): string {
    if (!/auth-required|restricted:/i.test(message)) return message
    if (this.authMode === 'off') {
      return `${message} (relay requires NIP-42 AUTH; bray will not authenticate because auth mode is "off" — set NOSTR_AUTH=1 to authenticate on demand)`
    }
    if (!this.authSigner) {
      return `${message} (relay requires NIP-42 AUTH but no signer is configured on the relay pool)`
    }
    return `${message} (NIP-42 AUTH was attempted and the relay still refused)`
  }

  /** Publish event to write relays for the given identity */
  async publish(npub: string, event: NostrEvent, opts: { timeoutMs?: number } = {}): Promise<PublishResult> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    const writeRelays = relays.write
    if (writeRelays.length === 0) {
      return { success: false, allAccepted: false, accepted: [], rejected: [], errors: ['no write relays configured'] }
    }

    const promises = pool.publish(writeRelays, event, this.#authParams())
    return this.#settlePublish(writeRelays, promises, opts.timeoutMs)
  }

  /** Publish event to explicit relay URLs (not identity-bound) */
  async publishDirect(
    relays: string[],
    event: NostrEvent,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<PublishResult> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    if (relays.length === 0) {
      return { success: false, allAccepted: false, accepted: [], rejected: [], errors: ['no relays specified'] }
    }

    const promises = opts.timeoutMs || opts.signal
      ? pool.publish(relays, event, { maxWait: opts.timeoutMs, abort: opts.signal, ...this.#authParams() })
      : pool.publish(relays, event, this.#authParams())
    return this.#settlePublish(relays, promises, opts.timeoutMs, opts.signal)
  }

  /** Settle a set of per-relay publish promises, optionally applying a deadline. */
  async #settlePublish(
    relayUrls: string[],
    promises: Promise<string>[],
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<PublishResult> {
    const wrap = (p: Promise<string>): Promise<string> => {
      if (!timeoutMs && !signal) return p
      return new Promise<string>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const cleanup = () => {
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
        }
        const abort = () => {
          cleanup()
          reject(new DOMException('Relay publish was cancelled', 'AbortError'))
        }
        if (signal?.aborted) return abort()
        signal?.addEventListener('abort', abort, { once: true })
        if (timeoutMs) {
          timer = setTimeout(() => {
            cleanup()
            reject(new Error(`timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        }
        p.then(
          value => { cleanup(); resolve(value) },
          error => { cleanup(); reject(error) },
        )
      })
    }

    const accepted: string[] = []
    const rejected: string[] = []
    const errors: string[] = []

    const results = await Promise.allSettled(relayUrls.map((_, i) => wrap(promises[i]!)))
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const url = relayUrls[i] ?? `relay-${i}`
      if (result.status === 'fulfilled' && isConnectionFailure(result.value)) {
        // nostr-tools resolves, rather than rejects, a publish whose relay it
        // could not connect to: the event never left this machine.
        rejected.push(url)
        errors.push(`${url}: ${result.value}`)
      } else if (result.status === 'fulfilled') {
        accepted.push(url)
      } else {
        rejected.push(url)
        errors.push(`${url}: ${this.#annotateAuthError(String(result.reason))}`)
      }
    }

    return {
      ...summarisePublish(accepted.length, relayUrls.length),
      accepted,
      rejected,
      errors,
    }
  }

  /**
   * Live subscription — calls onEvent for each matching event until the returned function is called.
   *
   * `onclose` is called once every relay has ended the subscription, with each
   * relay's reason (auth failures explained as for a publish). Closing it with
   * the returned function also ends it, with the reason "closed by caller".
   */
  async subscribe(
    relays: string[],
    filter: Filter,
    onEvent: (event: NostrEvent) => void,
    opts: { onclose?: (reasons: SubscriptionClose[]) => void } = {},
  ): Promise<() => void> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    if (!pool.subscribeMany) {
      throw new Error('The underlying pool does not support subscriptions. Ensure nostr-tools/pool is available.')
    }
    const { onclose } = opts
    const sub = pool.subscribeMany(relays, filter, {
      onevent: onEvent,
      ...(onclose ? {
        onclose: (reasons: SubscriptionClose[]) => onclose(reasons.map(({ url, reason }) => ({ url, reason: this.#annotateAuthError(reason) }))),
      } : {}),
      ...this.#authParams(),
    })
    return () => sub.close()
  }

  /**
   * One-shot query from read relays for the given identity.
   *
   * `onclose`, if given, receives each relay's reason for ending the REQ; see
   * {@link isNormalRequestEnd}. Without it a relay's refusal looks like no events.
   */
  async query(
    npub: string,
    filter: Filter,
    opts: { onclose?: (reasons: SubscriptionClose[]) => void } = {},
  ): Promise<NostrEvent[]> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    return this.#query(pool, relays.read, filter, this.#authParams(), opts.onclose)
  }

  /** One-shot query against explicit relay URLs (not identity-bound). `onclose` as for {@link query}. */
  async queryDirect(
    relays: string[],
    filter: Filter,
    opts: { timeoutMs?: number; signal?: AbortSignal; onclose?: (reasons: SubscriptionClose[]) => void } = {},
  ): Promise<NostrEvent[]> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    const params = opts.timeoutMs || opts.signal
      ? { maxWait: opts.timeoutMs, abort: opts.signal, ...this.#authParams() }
      : this.#authParams()
    return this.#query(pool, relays, filter, params, opts.onclose)
  }

  /**
   * querySync, except that it settles at once for no relays (querySync never
   * does, so a query with nothing to ask hung) and, given `onclose`, reports
   * each relay's reason for ending the REQ, which querySync drops.
   */
  #query(
    pool: PoolLike,
    relays: string[],
    filter: Filter,
    params: PoolParams,
    onclose?: (reasons: SubscriptionClose[]) => void,
  ): Promise<NostrEvent[]> {
    if (relays.length === 0) {
      onclose?.([])
      return Promise.resolve([])
    }
    const subscribeEose = pool.subscribeEose
    if (!onclose || !subscribeEose) return pool.querySync(relays, filter, params)
    return new Promise(resolve => {
      const events: NostrEvent[] = []
      subscribeEose(relays, filter, {
        ...params,
        onevent: event => { events.push(event) },
        onclose: reasons => {
          onclose(reasons.map(({ url, reason }) => ({ url, reason: this.#annotateAuthError(reason) })))
          resolve(events)
        },
      })
    })
  }

  /**
   * NIP-45 COUNT against explicit relays, on the pool's own connections, so
   * the Tor proxy, the relay URL rules and NIP-42 AUTH apply as for a query.
   * A relay that answers auth-required: is authenticated and asked again when
   * auth is on. nostr-tools sets no deadline on a COUNT, so `timeoutMs`
   * (default 5 s) bounds each relay's connection and each COUNT.
   */
  async countDirect(relays: string[], filter: Filter, opts: { timeoutMs?: number } = {}): Promise<RelayCount[]> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    const timeoutMs = opts.timeoutMs ?? 5_000
    return Promise.all(relays.map(url => this.#countOne(pool, url, filter, timeoutMs)))
  }

  async #countOne(pool: PoolLike, url: string, filter: Filter, timeoutMs: number): Promise<RelayCount> {
    if (!pool.ensureRelay) return { url, error: 'the underlying relay pool cannot send COUNT' }
    let relay: AbstractRelay
    try {
      relay = await pool.ensureRelay(url, { connectionTimeout: timeoutMs })
    } catch (err) {
      return { url, error: `connection failure: ${errorMessage(err)}` }
    }
    const count = async (): Promise<RelayCount> => {
      // countWithHLL resolves with the relay's whole COUNT payload, approximate included.
      const reply = await within(timeoutMs, relay.countWithHLL([filter], {}) as Promise<{ count: number; approximate?: boolean }>, 'COUNT timed out')
      return { url, count: reply.count, ...(reply.approximate ? { approximate: true } : {}) }
    }
    try {
      return await count()
    } catch (err) {
      const reason = errorMessage(err)
      const { onauth } = this.#authParams()
      if (!reason.startsWith('auth-required: ') || !onauth) return { url, error: this.#annotateAuthError(reason) }
      try {
        await relay.auth(onauth as Parameters<AbstractRelay['auth']>[0])
        return await count()
      } catch (authErr) {
        return { url, error: this.#annotateAuthError(errorMessage(authErr)) }
      }
    }
  }

  /**
   * NIP-42: authenticate the pool's own connection to `url` as the active
   * identity, so later queries and publishes to that relay on it are served.
   *
   * An explicit request, so it works in every auth mode. It waits for the
   * relay's challenge, prompting one with an empty REQ if the relay sends it
   * only after refusing a request (bray's serve --auth does). A connection
   * that carried another identity's traffic is replaced first; after a refusal
   * the connection is dropped, since nostr-tools keeps its first attempt and a
   * second try on it would only repeat the refusal.
   *
   * Each step has its own wait, and a timeout names the step. `timeoutMs`
   * (default 5 s) bounds the connection, the challenge and the relay's OK.
   * `signTimeoutMs` bounds the signature and defaults to `timeoutMs`: a signer
   * that answers over a relay (NIP-46) needs far longer than a local key, so
   * the caller gives it the remote signer's own limit.
   */
  async authenticate(url: string, opts: { timeoutMs?: number; signTimeoutMs?: number } = {}): Promise<{ authenticated: boolean; relay: string; pubkey?: string; error?: string }> {
    this.#validateDirectRelays([url])
    if (!this.authSigner) return { authenticated: false, relay: url, error: 'NIP-42 AUTH requested but no signer is configured' }
    const pool = await this.poolReady
    if (!pool.ensureRelay) return { authenticated: false, relay: url, error: 'the underlying relay pool cannot authenticate' }
    const timeoutMs = opts.timeoutMs ?? 5_000
    const signTimeoutMs = opts.signTimeoutMs ?? timeoutMs
    const { normalizeURL } = await import('nostr-tools/utils')
    const current = this.#activePubkey()
    const owner = this.#connectionOwners.get(normalizeURL(url))
    if (current !== undefined && owner?.usedBy !== undefined && owner.usedBy !== current) pool.forget?.(url)

    let relay: AbstractRelay
    try {
      relay = await pool.ensureRelay(url, { connectionTimeout: timeoutMs })
    } catch (err) {
      return { authenticated: false, relay: url, error: `connection failure: ${errorMessage(err)}` }
    }
    // nostr-tools keeps the latest challenge on the relay; it is private in its types.
    const challenge = () => (relay as unknown as { challenge?: string }).challenge
    const deadline = Date.now() + timeoutMs
    const probeAt = Date.now() + Math.min(500, timeoutMs / 2)
    let probed = false
    while (!challenge()) {
      if (Date.now() >= deadline) return { authenticated: false, relay: url, error: `AUTH handshake timed out (no challenge received within ${timeoutMs} ms)` }
      if (!probed && Date.now() >= probeAt) {
        probed = true
        const probe = relay.subscribe([{ limit: 0 }], { onevent: () => {}, oneose: () => probe.close(), onclose: () => {} })
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    // relay.auth signs, sends and waits for the relay's OK. The wait is split so
    // each part has its own budget and a timeout can say which part it was: the
    // signature (remote signers are slow) and then the relay's OK.
    let step: 'signature' | 'relay OK' = 'signature'
    let timer: ReturnType<typeof setTimeout> | undefined
    let startOk = () => {}
    let settled = false
    const expired = new Promise<never>((_, reject) => {
      const arm = (ms: number) => {
        clearTimeout(timer)
        timer = setTimeout(() => reject(new AuthTimeout(step, ms)), ms)
      }
      arm(signTimeoutMs)
      // A signature that arrives after the call ended must not start a timer.
      startOk = () => { if (settled) return; step = 'relay OK'; arm(timeoutMs) }
    })
    const signAndStartOk = async (evt: EventTemplate): Promise<NostrEvent> => {
      const signed = await this.#signAuth(evt)
      startOk()
      return signed
    }
    try {
      await Promise.race([relay.auth(signAndStartOk as Parameters<AbstractRelay['auth']>[0]), expired])
      return { authenticated: true, relay: url, pubkey: this.#connectionOwners.get(relay.url)?.authedBy ?? current }
    } catch (err) {
      pool.forget?.(url)
      if (err instanceof AuthTimeout) return { authenticated: false, relay: url, error: err.message }
      // A refusal before the relay was asked is the signer's, not the relay's.
      if (step === 'signature') return { authenticated: false, relay: url, error: `AUTH not signed: ${errorMessage(err)}` }
      return { authenticated: false, relay: url, error: `AUTH rejected: ${errorMessage(err)}` }
    } finally {
      settled = true
      clearTimeout(timer)
    }
  }

  /** Reconcile local event IDs with one relay using NIP-77 Negentropy. */
  async reconcileDirect(
    relayUrl: string,
    items: Array<{ id: string; createdAt: number }>,
    filter: Filter,
    opts: { timeoutMs?: number; signal?: AbortSignal; maxIds?: number } = {},
  ): Promise<ReconcileDirectResult> {
    this.#validateDirectRelays([relayUrl])
    const pool = await this.poolReady
    if (!pool.ensureRelay) {
      throw new Nip77UnavailableError('The underlying relay pool does not expose a NIP-77 connection')
    }

    const timeoutMs = opts.timeoutMs ?? 10_000
    const maxIds = opts.maxIds ?? 1_000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      throw new Error('timeoutMs must be an integer from 100 to 120000')
    }
    if (!Number.isInteger(maxIds) || maxIds < 1 || maxIds > 10_000) {
      throw new Error('maxIds must be an integer from 1 to 10000')
    }
    if (opts.signal?.aborted) throw new DOMException('NIP-77 reconciliation was cancelled', 'AbortError')

    const { nip77 } = await import('nostr-tools')
    const { NegentropyStorageVector, NegentropySync } = nip77
    const storage = new NegentropyStorageVector()
    for (const item of items) storage.insert(item.createdAt, item.id)
    storage.seal()

    let relay: AbstractRelay
    try {
      relay = await pool.ensureRelay(relayUrl, {
        connectionTimeout: timeoutMs,
        abort: opts.signal,
      })
    } catch (error) {
      if (opts.signal?.aborted) throw new DOMException('NIP-77 reconciliation was cancelled', 'AbortError')
      throw new Nip77UnavailableError(`Could not open NIP-77 relay connection: ${errorMessage(error)}`)
    }

    return new Promise<ReconcileDirectResult>((resolve, reject) => {
      const localOnlyIds: string[] = []
      const remoteOnlyIds: string[] = []
      let localOnlyCount = 0
      let remoteOnlyCount = 0
      let settled = false
      let clientClosedReconciliation = false
      let sync: InstanceType<typeof NegentropySync> | undefined

      const cleanup = () => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        try { sync?.close() } catch { /* relay may already be closed */ }
        reject(error)
      }
      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          localOnlyIds,
          remoteOnlyIds,
          localOnlyCount,
          remoteOnlyCount,
          truncated: localOnlyCount > maxIds || remoteOnlyCount > maxIds,
        })
      }
      const onAbort = () => fail(new DOMException('NIP-77 reconciliation was cancelled', 'AbortError'))
      const timer = setTimeout(
        () => fail(new Nip77UnavailableError(`NIP-77 reconciliation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      sync = new NegentropySync(relay, storage, filter, {
        label: 'bray-sync-plan',
        onhave: (id: string) => {
          localOnlyCount++
          if (localOnlyIds.length < maxIds) localOnlyIds.push(id)
        },
        onneed: (id: string) => {
          remoteOnlyCount++
          if (remoteOnlyIds.length < maxIds) remoteOnlyIds.push(id)
        },
        onclose: (reason?: string) => {
          if (reason) fail(new Nip77UnavailableError(`Relay rejected NIP-77 reconciliation: ${reason}`))
          else if (!clientClosedReconciliation) fail(new Nip77UnavailableError('Relay ended NIP-77 reconciliation without a completed diff'))
          else succeed()
        },
      })
      // nostr-tools currently reports NEG-ERR through onclose(undefined), the
      // same callback shape as success. On successful reconciliation it closes
      // its own subscription first; track that close so NEG-ERR cannot be
      // misreported as an empty, complete diff.
      const subscription = (sync as unknown as { subscription?: { close(): void } }).subscription
      if (subscription) {
        const close = subscription.close.bind(subscription)
        subscription.close = () => {
          clientClosedReconciliation = true
          close()
        }
      }
      void sync.start().catch((error: unknown) => fail(new Nip77UnavailableError(`Could not start NIP-77 reconciliation: ${errorMessage(error)}`)))
    })
  }

  /** Fetch the relay's NIP-11 `self` identity for verifying relay-generated events. */
  async getRelaySelfPubkey(relayUrl: string, opts: { timeoutMs?: number } = {}): Promise<string> {
    this.#validateDirectRelays([relayUrl])
    const cached = this.relaySelfCache.get(relayUrl)
    if (cached && cached.expiresAt > Date.now()) return cached.pubkey
    const pending = this.relaySelfPending.get(relayUrl)
    if (pending) return pending

    const request = (async () => {
      const httpUrl = relayUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
      const response = await brayFetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      })
      if (!response.ok) throw new Error(`NIP-11 fetch failed: ${response.status} ${response.statusText}`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!/^(application\/(nostr\+json|json))(\s*;|$)/i.test(contentType.trim())) {
        throw new Error(`NIP-11 response has wrong Content-Type: ${contentType.slice(0, 64) || '(none)'}`)
      }
      const text = await response.text()
      if (text.length > 1_048_576) throw new Error('Relay info document too large')
      let info: unknown
      try { info = JSON.parse(text) } catch { throw new Error('Relay info document is not valid JSON') }
      const self = (info as Record<string, unknown>)?.self
      if (typeof self !== 'string' || !/^[0-9a-f]{64}$/.test(self)) {
        throw new Error('Relay NIP-11 document has no valid 32-byte hex `self` pubkey')
      }
      this.relaySelfCache.set(relayUrl, { pubkey: self, expiresAt: Date.now() + 300_000 })
      return self
    })()
    this.relaySelfPending.set(relayUrl, request)
    try {
      return await request
    } finally {
      this.relaySelfPending.delete(relayUrl)
    }
  }

  /** Queue an event for publishing once the identity's relay list is known */
  queueWrite(npub: string, event: NostrEvent): void {
    const queue = this.writeQueue.get(npub) ?? []
    if (queue.length >= 100) {
      throw new Error(`Write queue full for ${npub} (max 100 events). Resolve relay list first.`)
    }
    queue.push(event)
    this.writeQueue.set(npub, queue)
  }

  /** Number of queued events for an identity */
  queueSize(npub: string): number {
    return this.writeQueue.get(npub)?.length ?? 0
  }

  /** Flush write queue for an identity, publishing all queued events */
  async flushQueue(npub: string): Promise<void> {
    const queue = this.writeQueue.get(npub)
    if (!queue || queue.length === 0) return

    this.writeQueue.delete(npub)
    for (const event of queue) {
      await this.publish(npub, event)
    }
  }

  /** Find relay URLs shared between two identities */
  checkSharedRelays(npubA: string, npubB: string): string[] {
    const relaysA = this.getRelays(npubA)
    const relaysB = this.getRelays(npubB)
    const allA = new Set([...relaysA.read, ...relaysA.write])
    const allB = new Set([...relaysB.read, ...relaysB.write])
    return [...allA].filter(url => allB.has(url))
  }

  /** Close all connections */
  close(): void {
    this.pool?.destroy()
  }

  private isOnion(url: string): boolean {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      // v3 onion: 56 base32 chars + .onion (lowercase a-z, digits 2-7)
      // v2 onion (deprecated): 16 base32 chars + .onion
      return /^[a-z2-7]{16}\.onion$/.test(host) || /^[a-z2-7]{56}\.onion$/.test(host)
    } catch {
      return false
    }
  }

  /** Apply the same SSRF, scheme, and Tor rules to every explicit relay operation. */
  #validateDirectRelays(relays: string[]): void {
    for (const url of relays) {
      if (!/^wss?:\/\//i.test(url) || url.length > 512) {
        throw new Error(`Invalid relay URL: ${url.slice(0, 128)}`)
      }
      validateRelayScheme(url, this.allowPrivateRelays)
      if (!this.allowPrivateRelays && !this.isOnion(url)) validatePublicUrl(url)
    }
    if (this.torProxy && !this.allowClearnet) {
      const clearnet = relays.filter(url => !this.isOnion(url))
      if (clearnet.length) {
        throw new Error(`Clearnet relays not allowed with Tor proxy: ${clearnet.join(', ')}`)
      }
    }
  }
}
