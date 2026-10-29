import WebSocket from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'

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

/**
 * The WebSocket class for a pool to use: SafeWebSocket, routed through the
 * SOCKS proxy when TOR_PROXY is set (socks5h, so .onion names resolve at the
 * proxy). Pass it to `new SimplePool({ websocketImplementation })` so the
 * pool does not depend on nostr-tools' process-wide default, which the
 * last `useWebSocketImplementation` call decides.
 */
export function webSocketFor(torProxy: string | undefined, extra: Record<string, unknown> = {}): typeof SafeWebSocket {
  if (!torProxy && Object.keys(extra).length === 0) return SafeWebSocket
  const agent = torProxy ? new SocksProxyAgent(torProxy) : undefined
  return class extends SafeWebSocket {
    constructor(...args: ConstructorParameters<typeof SafeWebSocket>) {
      const [url, protocols, options] = args
      super(url, protocols, {
        ...(typeof options === 'object' ? options : {}),
        ...extra,
        ...(agent ? { agent } : {}),
      })
    }
  }
}
