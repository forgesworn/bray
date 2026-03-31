import { validateRelayUrl } from './handlers.js'
import type { SigningContext } from '../signing-context.js'

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
  ctx: SigningContext,
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
