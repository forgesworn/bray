import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { PublishResult, RelaySet } from './types.js'

/** Minimal pool interface for dependency injection (testability) */
export interface PoolLike {
  publish(relays: string[], event: NostrEvent): Promise<string>[]
  querySync(relays: string[], filter: Filter): Promise<NostrEvent[]>
  destroy(): void
}

export interface RelayPoolConfig {
  torProxy?: string
  allowClearnet: boolean
  defaultRelays: string[]
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
        super(url, protocols, { ...options, agent })
      }
    }
    useWebSocketImplementation(ProxiedWebSocket)
  } else {
    useWebSocketImplementation(WS)
  }

  return new SimplePool() as unknown as PoolLike
}

export class RelayPool {
  private pool: PoolLike | undefined
  private poolReady: Promise<PoolLike>
  private relaySets = new Map<string, RelaySet>()
  private writeQueue = new Map<string, NostrEvent[]>()
  private defaults: RelaySet
  private torProxy?: string
  private allowClearnet: boolean

  constructor(config: RelayPoolConfig, injectedPool?: PoolLike) {
    this.torProxy = config.torProxy
    this.allowClearnet = config.allowClearnet

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
    // Enforce Tor policy on runtime relay additions
    if (this.torProxy && !this.allowClearnet) {
      const allUrls = [...relays.read, ...relays.write]
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
  async publish(npub: string, event: NostrEvent): Promise<PublishResult> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    const writeRelays = relays.write
    if (writeRelays.length === 0) {
      return { success: false, accepted: [], rejected: [], errors: ['no write relays configured'] }
    }

    const promises = pool.publish(writeRelays, event)
    const accepted: string[] = []
    const rejected: string[] = []
    const errors: string[] = []

    const results = await Promise.allSettled(promises)
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      const url = writeRelays[i] ?? `relay-${i}`
      if (result.status === 'fulfilled') {
        accepted.push(url)
      } else {
        rejected.push(url)
        errors.push(`${url}: ${result.reason}`)
      }
    }

    return {
      success: accepted.length === writeRelays.length,
      accepted,
      rejected,
      errors,
    }
  }

  /** One-shot query from read relays for the given identity */
  async query(npub: string, filter: Filter): Promise<NostrEvent[]> {
    const pool = await this.poolReady
    const relays = this.getRelays(npub)
    return pool.querySync(relays.read, filter)
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
      return parsed.hostname.endsWith('.onion')
    } catch {
      return false
    }
  }
}
