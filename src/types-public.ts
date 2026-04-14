/**
 * nostr-bray — public type barrel.
 *
 * Import from here when you need to annotate variables in your own code:
 *
 *   import type { PostResult, DmReadEntry, ZapReceipt } from 'nostr-bray/types'
 *
 * Experimental types are tagged `@experimental` and may change without
 * a semver-major bump until they graduate to stable.
 */

// ── SDK ───────────────────────────────────────────────────────────────────────
export type { BrayClient, BrayClientConfig } from './sdk.js'

// ── Core ──────────────────────────────────────────────────────────────────────
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

// ── Identity ──────────────────────────────────────────────────────────────────
export type { DeriveResult, AcceptMigrationResult } from './identity/handlers.js'
export type { BackupBundle, RestoreResult, MigrateSummary, MigrateResult } from './identity/migration.js'

// ── Social ────────────────────────────────────────────────────────────────────
export type {
  PostResult,
  ReplyResult,
  Contact,
  EnrichedContact,
  ContactGuardWarning,
  ProfileSetResult,
} from './social/handlers.js'
export type { DmSendResult, DmReadEntry } from './social/dm.js'
export type { Notification, FeedEntry } from './social/notifications.js'
export type { NipEvent } from './social/nips.js'

// ── Trust ─────────────────────────────────────────────────────────────────────
export type { AttestResult } from './trust/handlers.js'

// ── Relay ─────────────────────────────────────────────────────────────────────
export type {
  RelayHealthEntry,
  RelayListResult,
  RelayEntry,
  RelayQueryArgs,
} from './relay/handlers.js'

// ── Zap ───────────────────────────────────────────────────────────────────────
export type { NwcConnection, ZapReceipt } from './zap/handlers.js'

// ── Event ─────────────────────────────────────────────────────────────────────
export type { PublishRawResult } from './event/handlers.js'

// ── Util ──────────────────────────────────────────────────────────────────────
export type { DecodeResult, TombstoneResult } from './util/handlers.js'

// ── Experimental — workflow ───────────────────────────────────────────────────
export type {
  TrustScoreResponse,
  FeedSuggestion,
  VerificationResult,
  IdentitySetupPreview,
  IdentitySetupResult,
  IdentityRecoverResult,
  RelayHealthReport,
  OnboardStep,
  OnboardVerifiedResult,
} from './workflow/handlers.js'

// ── Experimental — dispatch ───────────────────────────────────────────────────
export type {
  DispatchSendResult,
  CheckedDispatchMessage,
  DispatchReplyResult,
} from './dispatch/handlers.js'
export type {
  DispatchThink,
  DispatchBuild,
  DispatchResult,
  DispatchAck,
  DispatchCancel,
  DispatchStatus,
  DispatchRefuse,
  DispatchFailure,
  DispatchQuery,
  DispatchPropose,
  DispatchMessage,
} from './dispatch/protocol.js'
export type { CapabilityCard, CapabilityPublishResult } from './dispatch/capabilities.js'

// ── Experimental — marketplace ────────────────────────────────────────────────
export type {
  ParsedPricing,
  ParsedCapability,
  ParsedService,
  L402Challenge,
  ProbeResult,
  ServiceComparison,
} from './marketplace/handlers.js'

// ── Experimental — privacy ────────────────────────────────────────────────────
export type {
  CommitResult,
  RangeProveResult,
  AgeProveResult,
} from './privacy/handlers.js'

// ── Experimental — moderation ─────────────────────────────────────────────────
export type { LabelCreateResult, LabelEvent } from './moderation/handlers.js'

// ── Experimental — signet ─────────────────────────────────────────────────────
export type {
  SignetBadgeResult,
  SignetCredential,
  SignetPolicyCheckResult,
  SignetVerifierResult,
} from './signet/handlers.js'

// ── Experimental — vault ──────────────────────────────────────────────────────
export type {
  VaultCreateResult,
  VaultEncryptResult,
  VaultShareResult,
  VaultReadResult,
  VaultReadSharedResult,
  VaultRevokeResult,
  VaultMemberEntry,
  VaultMembersResult,
} from './vault/handlers.js'

// ── Experimental — handler ────────────────────────────────────────────────────
export type {
  HandlerTransport,
  HandlerCard,
  HandlerPublishResult,
} from './handler/handlers.js'
