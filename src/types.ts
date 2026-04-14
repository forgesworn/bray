import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'

/** Public identity info returned by tools — never includes private keys */
export interface PublicIdentity {
  readonly npub: string
  readonly purpose?: string
  readonly index?: number
  readonly personaName?: string
}

/** Snapshot of an identity's replaceable events from relays */
export interface IdentitySnapshot {
  profile?: NostrEvent    // kind 0
  contacts?: NostrEvent   // kind 3
  relayList?: NostrEvent  // kind 10002
}

/** Signing function — signs an event template, returns signed event */
export type SignFn = (template: EventTemplate) => Promise<NostrEvent>

/** Relay set with read/write separation */
export interface RelaySet {
  read: string[]
  write: string[]
}

/** Result of a publish operation */
export interface PublishResult {
  /**
   * True when the event is reliably published: at least one relay accepted
   * AND at least 50% of attempted relays accepted. Captures both "reached
   * the network" and "reached a majority", which matches real-world
   * expectations where paywalled or whitelisted relays routinely reject.
   */
  success: boolean
  /**
   * True when every attempted relay accepted. Use this for high-assurance
   * publishing to a small curated list of private relays.
   */
  allAccepted: boolean
  accepted: string[]   // relay URLs that accepted
  rejected: string[]   // relay URLs that rejected
  errors: string[]     // error messages
}

/** Parsed configuration */
export interface BrayConfig {
  readonly secretKey: string
  readonly secretFormat: 'nsec' | 'hex' | 'mnemonic'
  readonly relays: string[]
  readonly bunkerUri?: string
  readonly nwcUri?: string
  readonly walletsFile: string
  readonly torProxy?: string
  readonly allowClearnetWithTor: boolean
  readonly allowPrivateRelays: boolean
  readonly nip04Enabled: boolean
  readonly veilCacheTtl: number
  readonly veilCacheMax: number
  readonly trustCacheTtl: number
  readonly trustCacheMax: number
  readonly trustMode: 'strict' | 'annotate' | 'off'
  readonly vaultEpochLength: 'daily' | 'weekly' | 'monthly'
  readonly transport: 'stdio' | 'http'
  readonly port: number
  readonly bindAddress: string
  readonly dispatchIdentities?: string
}

export type { SigningContext, ExtendedSigningContext } from './signing-context.js'
export { hasExtendedIdentity } from './signing-context.js'
