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
