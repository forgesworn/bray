/**
 * nostr-bray public API barrel.
 *
 * This is the library entry point — side-effect free.
 * The MCP server lives in src/index.ts and is not exported here.
 *
 * Usage:
 *   import { createBray, handleSocialPost } from 'nostr-bray'
 *   import { handleIdentityCreate } from 'nostr-bray/identity'
 *   import { handleSocialPost } from 'nostr-bray/social'
 */

// ── SDK factory ──────────────────────────────────────────────────────────────
export { createBray, defaultBray } from './sdk.js'
export type { BrayClient, BrayClientConfig } from './sdk.js'

// ── Shared types ─────────────────────────────────────────────────────────────
export type {
  PublicIdentity,
  IdentitySnapshot,
  SignFn,
  RelaySet,
  PublishResult,
  BrayConfig,
  SigningContext,
  ExtendedSigningContext,
} from './types.js'
export { hasExtendedIdentity } from './types.js'

// ── Infrastructure (advanced usage) ─────────────────────────────────────────
export { loadConfig, detectKeyFormat } from './config.js'
export { IdentityContext } from './context.js'
export { RelayPool } from './relay-pool.js'
export { Nip65Manager } from './nip65.js'

// ── Handlers — all categories ────────────────────────────────────────────────
export * from './identity/index.js'
export * from './social/index.js'
export * from './trust/index.js'
export * from './relay/index.js'
export * from './zap/index.js'
export * from './safety/index.js'
export * from './event/index.js'
export * from './util/index.js'
export * from './workflow/index.js'
export * from './dispatch/index.js'
export * from './marketplace/index.js'
export * from './privacy/index.js'
export * from './moderation/index.js'
export * from './signet/index.js'
export * from './vault/index.js'
export * from './handler/index.js'
