import type { Event as NostrEvent, UnsignedEvent } from 'nostr-tools'

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

/** Signing function — signs an unsigned event, returns signed event */
export type SignFn = (event: UnsignedEvent) => Promise<NostrEvent>

/** Relay set with read/write separation */
export interface RelaySet {
  read: string[]
  write: string[]
}

/** Result of a publish operation */
export interface PublishResult {
  success: boolean
  accepted: string[]   // relay URLs that accepted
  rejected: string[]   // relay URLs that rejected
  errors: string[]     // error messages
}

/** Parsed configuration */
export interface BrayConfig {
  readonly secretKey: string
  readonly secretFormat: 'nsec' | 'hex' | 'mnemonic'
  readonly relays: string[]
  readonly nwcUri?: string
  readonly torProxy?: string
  readonly allowClearnetWithTor: boolean
  readonly nip04Enabled: boolean
  readonly transport: 'stdio' | 'http'
  readonly port: number
  readonly bindAddress: string
}
