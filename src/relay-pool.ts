import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import type { PublishResult, RelaySet } from './types.js'
import { validatePublicUrl, validateRelayScheme } from './validation.js'
import { brayFetch } from './http-client.js'

// 512 KiB cap on any inbound relay frame. Protects against malicious relays
// pushing 100 MB EVENTs that would exhaust memory (ws library defaults to
// 100 MB maxPayload, which is far more than any legitimate Nostr event).
const WS_MAX_PAYLOAD = 512 * 1024

export interface Subscription {
  close(): void
}

/** Minimal pool interface for dependency injection (testability) */
export interface PoolLike {
  publish(relays: string[], event: NostrEvent, params?: { maxWait?: number; abort?: AbortSignal }): Promise<string>[]
  querySync(relays: string[], filter: Filter, params?: { maxWait?: number; abort?: AbortSignal }): Promise<NostrEvent[]>
  subscribeMany?(relays: string[], filter: Filter, handlers: { onevent(event: NostrEvent): void; oneose?(): void }): Subscription
  ensureRelay?(url: string, params?: { connectionTimeout?: number; abort?: AbortSignal }): Promise<AbstractRelay>
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
}

/** Initialise WebSocket and create a real SimplePool — lazy-loaded to avoid side effects at import */
async function createRealPool(torProxy?: string): Promise<PoolLike> {
  const { useWebSocketImplementation, SimplePool } = await import('nostr-tools/pool')
  const WS = (await import('ws')).default

  if (torProxy) {
    // Route all WebSocket connections through the SOCKS5h proxy for Tor
    // hostname is passed unresolved (socks5h) so DNS happens at the proxy
    const { SocksProxyAgent } = await import('socks-proxy-agent')
    const agent = new SocksProxyAgent(torProxy)
    const ProxiedWebSocket = class extends WS {
      constructor(url: string | URL, protocols?: any, options?: any) {
        super(url, protocols, { ...options, agent, maxPayload: WS_MAX_PAYLOAD })
      }
    }
    useWebSocketImplementation(ProxiedWebSocket)
  } else {
    const CappedWebSocket = class extends WS {
      constructor(url: string | URL, protocols?: any, options?: any) {
        super(url, protocols, { ...options, maxPayload: WS_MAX_PAYLOAD })
      }
    }
    useWebSocketImplementation(CappedWebSocket)
  }

  const pool = new SimplePool()
  return {
    publish: (relays, event, params) => pool.publish(relays, event, params),
    querySync: (relays, filter, params) => pool.querySync(relays, filter, params),
    subscribeMany: (relays, filters, handlers) => pool.subscribeMany(relays, filters, handlers),
    ensureRelay: (url, params) => pool.ensureRelay(url, params),
    destroy: () => pool.destroy(),
  } satisfies PoolLike
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

  constructor(config: RelayPoolConfig, injectedPool?: PoolLike) {
    this.torProxy = config.torProxy
    this.allowClearnet = config.allowClearnet
    this.allowPrivateRelays = config.allowPrivateRelays ?? false

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

  /** Get relay set for an identity, falling back to defaults */
  getRelays(npub: string): RelaySet {
    return this.relaySets.get(npub) ?? this.defaults
  }

  /** Publish event to write relays for the given identity */
  async publish(npub: string, event: NostrEvent, opts: { timeoutMs?: number } = {}): Promise<PublishResult> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    const writeRelays = relays.write
    if (writeRelays.length === 0) {
      return { success: false, allAccepted: false, accepted: [], rejected: [], errors: ['no write relays configured'] }
    }

    const promises = pool.publish(writeRelays, event)
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
      ? pool.publish(relays, event, { maxWait: opts.timeoutMs, abort: opts.signal })
      : pool.publish(relays, event)
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
      if (result.status === 'fulfilled') {
        accepted.push(url)
      } else {
        rejected.push(url)
        errors.push(`${url}: ${result.reason}`)
      }
    }

    return {
      ...summarisePublish(accepted.length, relayUrls.length),
      accepted,
      rejected,
      errors,
    }
  }

  /** Live subscription — calls onEvent for each matching event until the returned function is called. */
  async subscribe(
    relays: string[],
    filter: Filter,
    onEvent: (event: NostrEvent) => void,
  ): Promise<() => void> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    if (!pool.subscribeMany) {
      throw new Error('The underlying pool does not support subscriptions. Ensure nostr-tools/pool is available.')
    }
    const sub = pool.subscribeMany(relays, filter, { onevent: onEvent })
    return () => sub.close()
  }

  /** One-shot query from read relays for the given identity */
  async query(npub: string, filter: Filter): Promise<NostrEvent[]> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    return pool.querySync(relays.read, filter)
  }

  /** One-shot query against explicit relay URLs (not identity-bound) */
  async queryDirect(
    relays: string[],
    filter: Filter,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<NostrEvent[]> {
    this.#validateDirectRelays(relays)
    const pool = await this.poolReady
    return opts.timeoutMs || opts.signal
      ? pool.querySync(relays, filter, { maxWait: opts.timeoutMs, abort: opts.signal })
      : pool.querySync(relays, filter)
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
      throw new Nip77UnavailableError(`Could not open NIP-77 relay connection: ${(error as Error).message}`)
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
      void sync.start().catch((error: unknown) => fail(new Nip77UnavailableError(`Could not start NIP-77 reconciliation: ${(error as Error).message}`)))
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
