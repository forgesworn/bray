import WebSocket from 'ws'

/**
 * A `ws` WebSocket that cannot crash the process with an unhandled `error`.
 *
 * nostr-tools clears `onerror` before closing a relay socket (Relay.close(),
 * and handleHardClose() on a connection timeout). If that socket is still
 * connecting, `ws` then emits "WebSocket was closed before the connection was
 * established" with no listener, and Node treats an unhandled `error` event
 * as fatal. That happens when a pool is destroyed while a relay is still
 * connecting, for example after an unreachable relay during `bunker pair`
 * (see also nbd-wtf/nostr-tools#557).
 *
 * A permanent no-op listener makes that late error harmless. nostr-tools'
 * own `onerror` handler still runs while it is attached, so connection
 * failures are reported exactly as before.
 */
export class SafeWebSocket extends WebSocket {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args)
    this.on('error', () => { /* handled through onerror while nostr-tools listens */ })
  }
}
