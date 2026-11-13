import { validateRelayUrl } from './handlers.js'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import { errorMessage } from '../error-message.js'

export interface RelayAuthResult {
  authenticated: boolean
  relay: string
  pubkey?: string
  error?: string
}

/**
 * Authenticate to a relay that requires NIP-42 AUTH.
 *
 * Pass the `RelayPool` as the third argument: the pool's own connection to the
 * relay is then authenticated as the active identity, through TOR_PROXY and the
 * relay URL rules, so later queries and publishes to that relay on it are
 * served (see RelayPool.authenticate).
 *
 * The older two-argument form still works but opens a separate WebSocket,
 * ignores TOR_PROXY, and closes that connection once authenticated, so the
 * AUTH applies to nothing else. It only shows that the relay accepts the key.
 *
 * Flow:
 * 1. Connect via WebSocket
 * 2. Wait for ["AUTH", challenge] message
 * 3. Sign a kind 22242 event with challenge + relay tags
 * 4. Send ["AUTH", signedEvent]
 * 5. Wait for ["OK", eventId, true, ...] confirmation
 */
export async function handleRelayAuth(
  ctx: SigningContext,
  relay: string,
  pool?: RelayPool,
): Promise<RelayAuthResult> {
  if (pool) {
    validateRelayUrl(relay, { allowPrivate: pool.allowsPrivateRelays?.() === true })
    return pool.authenticate(relay)
  }
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
                resolve({ authenticated: false, relay, error: `Failed to sign AUTH event: ${errorMessage(err)}` })
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
        resolve({ authenticated: false, relay, error: `Failed to create WebSocket: ${errorMessage(err)}` })
      }
    })
  })
}
