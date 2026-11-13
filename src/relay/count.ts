import type { Filter } from 'nostr-tools'
import type { RelayPool } from '../relay-pool.js'
import { validateRelayUrl } from './handlers.js'
import { errorMessage } from '../error-message.js'

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

type PoolQuery = (relays: string[], filter: Record<string, unknown>) => Promise<unknown[]>

/**
 * Send a NIP-45 COUNT to each relay, falling back to fetch-and-count (capped at
 * 1000) when a relay does not support NIP-45.
 *
 * Pass the `RelayPool` as the third argument: the COUNT then goes over the
 * pool's own connections, so TOR_PROXY, BRAY_ALLOW_PRIVATE_RELAYS and NIP-42
 * AUTH apply as for any query, and a relay that refuses (auth-required:,
 * restricted:) or cannot be reached is reported, not counted by fallback.
 *
 * The older form, with a query function or nothing as the third argument,
 * still works but opens its own WebSocket to each relay: it ignores TOR_PROXY
 * and does not authenticate.
 */
export async function handleRelayCount(
  relays: string[],
  filter: Record<string, unknown>,
  through?: RelayPool | PoolQuery,
): Promise<RelayCountResult> {
  if (through && typeof through !== 'function') return countThroughPool(through, relays, filter)
  const poolQuery = through
  for (const url of relays) validateRelayUrl(url)

  const results = await Promise.all(
    relays.map(url => countFromRelay(url, filter, poolQuery)),
  )

  return {
    counts: results,
    total: results.reduce((sum, r) => sum + (r.error ? 0 : r.count), 0),
  }
}

/** A refusal or an unreachable relay: a REQ would fare no better, so no fallback. */
const noFallback = (error: string): boolean => /^(auth-required|restricted):|^connection failure/.test(error)

async function countThroughPool(
  pool: RelayPool,
  relays: string[],
  filter: Record<string, unknown>,
): Promise<RelayCountResult> {
  const allowPrivate = pool.allowsPrivateRelays?.() === true
  for (const url of relays) validateRelayUrl(url, { allowPrivate })
  const answers = await pool.countDirect(relays, filter as Filter)
  const counts = await Promise.all(answers.map(async (answer): Promise<CountResult> => {
    if (answer.error === undefined) {
      return { relay: answer.url, count: answer.count ?? 0, ...(answer.approximate ? { estimated: true } : {}) }
    }
    if (noFallback(answer.error)) return { relay: answer.url, count: 0, error: answer.error }
    // No NIP-45 (or no answer in time): count a capped REQ instead.
    try {
      const events = await pool.queryDirect([answer.url], { ...filter, limit: 1000 } as Filter)
      return { relay: answer.url, count: events.length, fallback: true, estimated: events.length >= 1000 }
    } catch (err) {
      return { relay: answer.url, count: 0, error: `COUNT failed (${answer.error}) and the fallback failed: ${errorMessage(err)}` }
    }
  }))
  return {
    counts,
    total: counts.reduce((sum, r) => sum + (r.error ? 0 : r.count), 0),
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
          error: `COUNT not supported and fallback failed: ${errorMessage(fallbackErr)}`,
        }
      }
    }
    return {
      relay: url,
      count: 0,
      error: `COUNT not supported: ${errorMessage(err)}`,
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
