import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { PublishResult, RelaySet } from './types.js'
import { validatePublicUrl } from './validation.js'

// 512 KiB cap on any inbound relay frame. Protects against malicious relays
// pushing 100 MB EVENTs that would exhaust memory (ws library defaults to
// 100 MB maxPayload, which is far more than any legitimate Nostr event).
const WS_MAX_PAYLOAD = 512 * 1024

export interface Subscription {
  close(): void
}

/** Minimal pool interface for dependency injection (testability) */
export interface PoolLike {
  publish(relays: string[], event: NostrEvent): Promise<string>[]
  querySync(relays: string[], filter: Filter): Promise<NostrEvent[]>
  subscribeMany?(relays: string[], filter: Filter, handlers: { onevent(event: NostrEvent): void; oneose?(): void }): Subscription
  destroy(): void
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
    publish: (relays, event) => pool.publish(relays, event),
    querySync: (relays, filter) => pool.querySync(relays, filter),
    subscribeMany: (relays, filters, handlers) => pool.subscribeMany(relays, filters, handlers),
    destroy: () => pool.destroy(),
  } satisfies PoolLike
}

export class RelayPool {
  private pool: PoolLike | undefined
  private poolReady: Promise<PoolLike>
  private relaySets = new Map<string, RelaySet>()
  private writeQueue = new Map<string, NostrEvent[]>()
  private defaults: RelaySet
  private torProxy?: string
  private allowClearnet: boolean
  private allowPrivateRelays: boolean

  constructor(config: RelayPoolConfig, injectedPool?: PoolLike) {
    this.torProxy = config.torProxy
    this.allowClearnet = config.allowClearnet
    this.allowPrivateRelays = config.allowPrivateRelays ?? false

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
  async publishDirect(relays: string[], event: NostrEvent, opts: { timeoutMs?: number } = {}): Promise<PublishResult> {
    const pool = await this.poolReady
    if (relays.length === 0) {
      return { success: false, allAccepted: false, accepted: [], rejected: [], errors: ['no relays specified'] }
    }

    const promises = pool.publish(relays, event)
    return this.#settlePublish(relays, promises, opts.timeoutMs)
  }

  /** Settle a set of per-relay publish promises, optionally applying a deadline. */
  async #settlePublish(
    relayUrls: string[],
    promises: Promise<string>[],
    timeoutMs?: number,
  ): Promise<PublishResult> {
    const wrap = (p: Promise<string>): Promise<string> => {
      if (!timeoutMs) return p
      const deadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs),
      )
      return Promise.race([p, deadline])
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
  async queryDirect(relays: string[], filter: Filter): Promise<NostrEvent[]> {
    const pool = await this.poolReady
    return pool.querySync(relays, filter)
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
}
