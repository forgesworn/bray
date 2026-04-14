/**
 * Bray HTTP client — configures process-wide fetch to route through a SOCKS5
 * proxy when Tor is in use. Every call to the global `fetch` (from anywhere
 * in the process) flows through the proxy after `configureHttpClient` has
 * been called at startup. This is structural protection against DNS/IP
 * leaks on Tor deployments: no callsite needs to remember to use a special
 * helper, and any fetch added in future is covered automatically.
 *
 * For callsites that want explicit timeout / body-size hardening on top,
 * use `brayFetch` from this module.
 */

import {
  Socks5ProxyAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici'

export interface HttpClientConfig {
  /** SOCKS5(h) proxy URL, e.g. `socks5h://127.0.0.1:9050`. If unset, direct. */
  torProxy?: string
}

let configured = false
let originalDispatcher: Dispatcher | undefined
let currentDispatcher: Dispatcher | undefined

/**
 * Install the SOCKS5 dispatcher globally when a Tor proxy is configured.
 * Safe to call multiple times — the most recent configuration wins, and
 * the original dispatcher is remembered so `resetHttpClient` restores it.
 */
export function configureHttpClient(config: HttpClientConfig): void {
  if (!configured) {
    originalDispatcher = getGlobalDispatcher()
    configured = true
  }

  if (!config.torProxy) {
    // No proxy — use the default dispatcher.
    if (originalDispatcher) setGlobalDispatcher(originalDispatcher)
    currentDispatcher = originalDispatcher
    return
  }

  // undici's Socks5ProxyAgent accepts `socks5://` or `socks://`. The
  // `socks5h://` scheme (remote DNS) is also the SOCKS5 default behaviour
  // in undici — it passes hostnames with ATYP=DOMAIN, so DNS happens at
  // the proxy. Normalise the scheme before constructing the agent.
  const normalised = config.torProxy.replace(/^socks5h:\/\//i, 'socks5://')

  const agent = new Socks5ProxyAgent(normalised)
  setGlobalDispatcher(agent)
  currentDispatcher = agent
}

/**
 * Restore the original dispatcher. Intended for test teardown.
 */
export function resetHttpClient(): void {
  if (originalDispatcher) setGlobalDispatcher(originalDispatcher)
  currentDispatcher = originalDispatcher
}

/** True when the global dispatcher has been swapped to a Tor proxy. */
export function isTorRouted(): boolean {
  return currentDispatcher !== undefined && currentDispatcher !== originalDispatcher
}

/**
 * Explicit fetch wrapper for callsites that want the Tor guarantee to be
 * obvious at the callsite. Functionally identical to calling global
 * `fetch` after `configureHttpClient` has run — kept as a named export
 * so security-sensitive code can document intent.
 */
export function brayFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

/** Test-only: reset the configured flag so the next configure starts fresh. */
export function __resetHttpClientForTests(): void {
  if (originalDispatcher) {
    setGlobalDispatcher(originalDispatcher)
  }
  configured = false
  originalDispatcher = undefined
  currentDispatcher = undefined
}
