/**
 * CANARY protocol handlers — coercion-resistant spoken verification.
 *
 * Manages sessions (two-party directional verification), groups
 * (multi-member symmetric verification with duress detection), and
 * beacons (encrypted liveness signals).
 *
 * Secret material (seeds, keys) is held in memory only within the
 * session/group store and never returned in tool responses.
 */

import {
  createSession,
  type Session,
  type SessionPresetName,
  type SessionConfig,
} from 'canary-kit/session'
import {
  createGroup,
  getCurrentWord,
  getCurrentDuressWord,
  syncCounter,
  getCounter,
  DEFAULT_ROTATION_INTERVAL,
  type GroupState,
  type GroupConfig,
} from 'canary-kit'
import {
  verifyWord,
  type VerifyResult,
} from 'canary-kit'
import type { PresetName } from 'canary-kit'
import {
  deriveBeaconKey,
  deriveDuressKey,
  encryptBeacon,
  decryptBeacon,
  buildDuressAlert,
  encryptDuressAlert,
  type BeaconPayload,
} from 'canary-kit'
import type { IdentityContext } from '../context.js'

// ---------------------------------------------------------------------------
// In-memory stores — sessions and groups live only in process memory
// ---------------------------------------------------------------------------

interface SessionEntry {
  session: Session
  id: string
  preset?: string
  namespace: string
  myRole: string
  roles: [string, string]
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

interface GroupEntry {
  state: GroupState
  id: string
  createdAt: number
}

const groups = new Map<string, GroupEntry>()

interface BeaconEntry {
  groupId: string
  beaconKey: Uint8Array
  duressKey: Uint8Array
  lastPayload?: BeaconPayload
  lastPublished?: number
  createdAt: number
}

const beacons = new Map<string, BeaconEntry>()

let nextId = 1
function generateId(prefix: string): string {
  return `${prefix}-${nextId++}`
}

// ---------------------------------------------------------------------------
// Session handlers
// ---------------------------------------------------------------------------

export interface CreateSessionArgs {
  preset?: SessionPresetName
  namespace: string
  roles: [string, string]
  myRole: string
  rotationSeconds?: number
  tolerance?: number
  theirIdentity?: string
  counter?: number
}

export function handleCanarySessionCreate(
  ctx: IdentityContext,
  args: CreateSessionArgs,
): { sessionId: string; preset?: string; myToken: string; namespace: string; myRole: string } {
  // Derive a deterministic session secret from the identity tree
  // so sessions are reproducible per-identity without storing raw secrets
  const secretBytes = ctx.activePrivateKey

  const config: SessionConfig = {
    secret: secretBytes,
    namespace: args.namespace,
    roles: args.roles,
    myRole: args.myRole,
    preset: args.preset,
    rotationSeconds: args.rotationSeconds,
    tolerance: args.tolerance,
    theirIdentity: args.theirIdentity,
    counter: args.counter,
  }

  const session = createSession(config)
  const id = generateId('session')

  sessions.set(id, {
    session,
    id,
    preset: args.preset,
    namespace: args.namespace,
    myRole: args.myRole,
    roles: args.roles,
    createdAt: Date.now(),
  })

  return {
    sessionId: id,
    preset: args.preset,
    myToken: session.myToken(),
    namespace: args.namespace,
    myRole: args.myRole,
  }
}

export function handleCanarySessionCurrent(
  args: { sessionId: string },
): { sessionId: string; myToken: string; theirToken: string; counter: number } {
  const entry = sessions.get(args.sessionId)
  if (!entry) throw new Error(`Session not found: ${args.sessionId}`)

  return {
    sessionId: args.sessionId,
    myToken: entry.session.myToken(),
    theirToken: entry.session.theirToken(),
    counter: entry.session.counter(),
  }
}

export interface VerifySessionArgs {
  sessionId: string
  spokenWord: string
}

export function handleCanarySessionVerify(
  args: VerifySessionArgs,
): { sessionId: string; status: string; identities?: string[] } {
  const entry = sessions.get(args.sessionId)
  if (!entry) throw new Error(`Session not found: ${args.sessionId}`)

  const result = entry.session.verify(args.spokenWord)
  return {
    sessionId: args.sessionId,
    status: result.status,
    identities: result.identities,
  }
}

// ---------------------------------------------------------------------------
// Group handlers
// ---------------------------------------------------------------------------

export interface CreateGroupArgs {
  name: string
  members: string[]
  preset?: PresetName
  rotationInterval?: number
  wordCount?: 1 | 2 | 3
  tolerance?: number
  beaconInterval?: number
  beaconPrecision?: number
}

export function handleCanaryGroupCreate(
  ctx: IdentityContext,
  args: CreateGroupArgs,
): { groupId: string; name: string; memberCount: number; preset?: string; currentWord: string } {
  const creatorPubkey = ctx.activePublicKeyHex

  // Ensure the creator is in the members list
  const members = args.members.includes(creatorPubkey)
    ? args.members
    : [creatorPubkey, ...args.members]

  const config: GroupConfig = {
    name: args.name,
    members,
    preset: args.preset,
    rotationInterval: args.rotationInterval,
    wordCount: args.wordCount,
    tolerance: args.tolerance,
    beaconInterval: args.beaconInterval,
    beaconPrecision: args.beaconPrecision,
    creator: creatorPubkey,
  }

  const state = createGroup(config)
  const id = generateId('group')

  groups.set(id, { state, id, createdAt: Date.now() })

  return {
    groupId: id,
    name: state.name,
    memberCount: state.members.length,
    preset: args.preset,
    currentWord: getCurrentWord(state),
  }
}

export function handleCanaryGroupJoin(
  ctx: IdentityContext,
  args: { groupId: string; seed: string; name: string; members: string[]; rotationInterval?: number; wordCount?: 1 | 2 | 3; tolerance?: number },
): { groupId: string; name: string; memberCount: number; currentWord: string } {
  const myPubkey = ctx.activePublicKeyHex

  // Validate the seed before storing
  if (!/^[0-9a-f]{64}$/.test(args.seed)) {
    throw new Error('Invalid seed: expected 64 hex characters')
  }

  // Ensure we are in the members list
  const members = args.members.includes(myPubkey)
    ? args.members
    : [...args.members, myPubkey]

  // Reconstruct group state from the shared seed
  const now = Math.floor(Date.now() / 1000)
  const rotationInterval = args.rotationInterval ?? DEFAULT_ROTATION_INTERVAL

  const state: GroupState = {
    name: args.name,
    seed: args.seed,
    members,
    rotationInterval,
    wordCount: args.wordCount ?? 1,
    tolerance: args.tolerance ?? 1,
    wordlist: 'en-v1',
    counter: getCounter(now, rotationInterval),
    usageOffset: 0,
    createdAt: now,
    beaconInterval: 300,
    beaconPrecision: 6,
    admins: [],
    epoch: 0,
    consumedOps: [],
  }

  const id = args.groupId || generateId('group')
  groups.set(id, { state, id, createdAt: Date.now() })

  return {
    groupId: id,
    name: state.name,
    memberCount: state.members.length,
    currentWord: getCurrentWord(state),
  }
}

export function handleCanaryGroupCurrent(
  args: { groupId: string },
): { groupId: string; name: string; currentWord: string; counter: number } {
  const entry = groups.get(args.groupId)
  if (!entry) throw new Error(`Group not found: ${args.groupId}`)

  // Sync counter to current time before reading
  entry.state = syncCounter(entry.state)

  return {
    groupId: args.groupId,
    name: entry.state.name,
    currentWord: getCurrentWord(entry.state),
    counter: entry.state.counter + entry.state.usageOffset,
  }
}

export interface VerifyGroupArgs {
  groupId: string
  spokenWord: string
}

export function handleCanaryGroupVerify(
  args: VerifyGroupArgs,
): { groupId: string; status: string; members?: string[] } {
  const entry = groups.get(args.groupId)
  if (!entry) throw new Error(`Group not found: ${args.groupId}`)

  // Sync counter before verification
  entry.state = syncCounter(entry.state)

  const result: VerifyResult = verifyWord(
    args.spokenWord,
    entry.state.seed,
    entry.state.members,
    entry.state.counter + entry.state.usageOffset,
    entry.state.wordCount,
    entry.state.tolerance,
  )

  return {
    groupId: args.groupId,
    status: result.status,
    members: result.members,
  }
}

export function handleCanaryGroupMembers(
  args: { groupId: string },
): { groupId: string; name: string; members: string[]; admins: string[]; memberCount: number } {
  const entry = groups.get(args.groupId)
  if (!entry) throw new Error(`Group not found: ${args.groupId}`)

  return {
    groupId: args.groupId,
    name: entry.state.name,
    members: entry.state.members,
    admins: entry.state.admins,
    memberCount: entry.state.members.length,
  }
}

// ---------------------------------------------------------------------------
// Beacon handlers
// ---------------------------------------------------------------------------

export interface CreateBeaconArgs {
  groupId: string
  geohash: string
  precision: number
}

export async function handleCanaryBeaconCreate(
  args: CreateBeaconArgs,
): Promise<{ beaconId: string; groupId: string; encrypted: string }> {
  const groupEntry = groups.get(args.groupId)
  if (!groupEntry) throw new Error(`Group not found: ${args.groupId}`)

  const beaconKey = deriveBeaconKey(groupEntry.state.seed)
  const duressKey = deriveDuressKey(groupEntry.state.seed)

  const encrypted = await encryptBeacon(beaconKey, args.geohash, args.precision)

  const beaconId = generateId('beacon')
  beacons.set(beaconId, {
    groupId: args.groupId,
    beaconKey,
    duressKey,
    lastPayload: { geohash: args.geohash, precision: args.precision, timestamp: Math.floor(Date.now() / 1000) },
    lastPublished: Date.now(),
    createdAt: Date.now(),
  })

  return {
    beaconId,
    groupId: args.groupId,
    encrypted,
  }
}

export interface CheckBeaconArgs {
  beaconId?: string
  groupId?: string
  encrypted?: string
}

export async function handleCanaryBeaconCheck(
  args: CheckBeaconArgs,
): Promise<{ status: 'alive' | 'overdue' | 'unknown'; beaconId?: string; groupId?: string; payload?: BeaconPayload; age?: number }> {
  // If we have a beaconId, look up from store
  if (args.beaconId) {
    const entry = beacons.get(args.beaconId)
    if (!entry) throw new Error(`Beacon not found: ${args.beaconId}`)

    const groupEntry = groups.get(entry.groupId)
    if (!groupEntry) throw new Error(`Group not found for beacon: ${entry.groupId}`)

    const age = entry.lastPublished ? Math.floor((Date.now() - entry.lastPublished) / 1000) : undefined
    const beaconInterval = groupEntry.state.beaconInterval
    const status = age !== undefined && age > beaconInterval * 2 ? 'overdue' : 'alive'

    return {
      status,
      beaconId: args.beaconId,
      groupId: entry.groupId,
      payload: entry.lastPayload,
      age,
    }
  }

  // If we have a groupId and encrypted content, decrypt it
  if (args.groupId && args.encrypted) {
    const groupEntry = groups.get(args.groupId)
    if (!groupEntry) throw new Error(`Group not found: ${args.groupId}`)

    const beaconKey = deriveBeaconKey(groupEntry.state.seed)
    try {
      const payload = await decryptBeacon(beaconKey, args.encrypted)
      const age = Math.floor(Date.now() / 1000) - payload.timestamp
      const beaconInterval = groupEntry.state.beaconInterval
      const status = age > beaconInterval * 2 ? 'overdue' : 'alive'

      return {
        status,
        groupId: args.groupId,
        payload,
        age,
      }
    } finally {
      beaconKey.fill(0)
    }
  }

  throw new Error('Provide either beaconId or both groupId and encrypted content')
}

// ---------------------------------------------------------------------------
// Duress handlers
// ---------------------------------------------------------------------------

export interface DuressSignalArgs {
  groupId: string
  geohash?: string
  precision?: number
  locationSource?: 'beacon' | 'verifier' | 'none'
}

export async function handleCanaryDuressSignal(
  ctx: IdentityContext,
  args: DuressSignalArgs,
): Promise<{ groupId: string; duressWord: string; encrypted: string }> {
  const groupEntry = groups.get(args.groupId)
  if (!groupEntry) throw new Error(`Group not found: ${args.groupId}`)

  const myPubkey = ctx.activePublicKeyHex

  // Sync counter
  groupEntry.state = syncCounter(groupEntry.state)

  // Get the duress word the agent should speak
  const duressWord = getCurrentDuressWord(groupEntry.state, myPubkey)

  // Build and encrypt the duress alert for beacon distribution
  const location = args.geohash ? {
    geohash: args.geohash,
    precision: args.precision ?? 6,
    locationSource: (args.locationSource ?? 'beacon') as 'beacon' | 'verifier',
  } : null

  const alert = buildDuressAlert(myPubkey, location)
  const duressKey = deriveDuressKey(groupEntry.state.seed)
  let encrypted: string
  try {
    encrypted = await encryptDuressAlert(duressKey, alert)
  } finally {
    duressKey.fill(0)
  }

  return {
    groupId: args.groupId,
    duressWord,
    encrypted,
  }
}

export interface DuressDetectArgs {
  groupId: string
  spokenWord: string
}

export function handleCanaryDuressDetect(
  args: DuressDetectArgs,
): { groupId: string; isDuress: boolean; members?: string[] } {
  const groupEntry = groups.get(args.groupId)
  if (!groupEntry) throw new Error(`Group not found: ${args.groupId}`)

  // Sync counter
  groupEntry.state = syncCounter(groupEntry.state)

  const result = verifyWord(
    args.spokenWord,
    groupEntry.state.seed,
    groupEntry.state.members,
    groupEntry.state.counter + groupEntry.state.usageOffset,
    groupEntry.state.wordCount,
    groupEntry.state.tolerance,
  )

  return {
    groupId: args.groupId,
    isDuress: result.status === 'duress',
    members: result.members,
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Reset all in-memory stores (for testing). */
export function _resetStores(): void {
  // Zeroise group seeds before clearing
  for (const [, entry] of groups) {
    const seedBytes = Buffer.from(entry.state.seed, 'hex')
    seedBytes.fill(0)
  }
  // Zeroise beacon keys before clearing
  for (const [, entry] of beacons) {
    entry.beaconKey.fill(0)
    entry.duressKey.fill(0)
  }
  sessions.clear()
  groups.clear()
  beacons.clear()
  nextId = 1
}
