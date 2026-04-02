/**
 * NIP-A7 Spell casting — parse kind 777 events, resolve runtime
 * variables ($me, $contacts), resolve relative timestamps, and
 * execute the resulting REQ filter.
 */

import type { Event as NostrEvent, Filter } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'

/** Relative timestamp units in seconds */
const UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  mo: 2_592_000,   // 30 days
  y: 31_536_000,   // 365 days
}

/** Parse a timestamp value: unix number, relative (e.g. "7d"), or "now" */
function resolveTimestamp(value: string): number {
  if (value === 'now') return Math.floor(Date.now() / 1000)
  const unix = Number(value)
  if (!Number.isNaN(unix) && unix > 1_000_000_000) return unix
  const match = value.match(/^(\d+)(s|m|h|d|w|mo|y)$/)
  if (!match) throw new Error(`Invalid timestamp value: ${value}`)
  const amount = parseInt(match[1], 10)
  const unit = match[2]
  return Math.floor(Date.now() / 1000) - amount * UNITS[unit]
}

/** Resolve $me and $contacts in an array of values */
async function resolveVariables(
  values: string[],
  myPubkey: string,
  getContacts: () => Promise<string[]>,
): Promise<string[]> {
  const resolved: string[] = []
  for (const v of values) {
    if (v === '$me') {
      resolved.push(myPubkey)
    } else if (v === '$contacts') {
      resolved.push(...await getContacts())
    } else {
      resolved.push(v)
    }
  }
  return resolved
}

export interface CastSpellArgs {
  /** Event ID of the Spell to cast */
  eventId?: string
  /** Or pass the Spell event directly (from a prior relay-query) */
  spell?: NostrEvent
  /** Override relays for the result query */
  relays?: string[]
}

export interface CastSpellResult {
  spellName: string
  filter: Filter
  count: number
  events: Array<{
    id: string
    pubkey: string
    kind: number
    tags: string[][]
    content: string
    created_at: number
  }>
}

export async function handleCastSpell(
  ctx: SigningContext,
  pool: RelayPool,
  args: CastSpellArgs,
): Promise<CastSpellResult> {
  // Step 1: get the Spell event
  let spell = args.spell
  if (!spell && args.eventId) {
    const results = await pool.query(ctx.activeNpub, {
      ids: [args.eventId],
      kinds: [777],
      limit: 1,
    })
    if (results.length === 0) throw new Error(`Spell not found: ${args.eventId}`)
    spell = results[0]
  }
  if (!spell) throw new Error('Provide either eventId or spell')
  if (spell.kind !== 777) throw new Error(`Not a Spell: kind ${spell.kind}`)

  // Step 2: parse tags into filter
  const tags = spell.tags
  const cmd = tags.find(t => t[0] === 'cmd')?.[1]
  if (cmd && cmd !== 'REQ') throw new Error(`Unsupported Spell command: ${cmd}`)

  const spellName = tags.find(t => t[0] === 'name')?.[1] ?? '(unnamed)'
  const filter: Filter = {}
  let spellRelays: string[] | undefined

  // Lazy contact list fetch (cached per cast)
  let contactsCache: string[] | undefined
  const getContacts = async (): Promise<string[]> => {
    if (contactsCache) return contactsCache
    const events = await pool.query(ctx.activeNpub, {
      kinds: [3],
      authors: [ctx.activePublicKeyHex],
      limit: 1,
    })
    if (events.length === 0) {
      contactsCache = []
      return contactsCache
    }
    const best = events.reduce((a, b) => b.created_at > a.created_at ? b : a)
    contactsCache = best.tags.filter(t => t[0] === 'p').map(t => t[1])
    return contactsCache
  }

  for (const tag of tags) {
    switch (tag[0]) {
      case 'k':
        if (!filter.kinds) filter.kinds = []
        filter.kinds.push(parseInt(tag[1], 10))
        break

      case 'authors': {
        const resolved = await resolveVariables(tag.slice(1), ctx.activePublicKeyHex, getContacts)
        filter.authors = resolved
        break
      }

      case 'ids':
        filter.ids = tag.slice(1)
        break

      case 'tag': {
        // ["tag", <letter>, ...values] → filter: {"#<letter>": [...values]}
        const letter = tag[1]
        const values = await resolveVariables(tag.slice(2), ctx.activePublicKeyHex, getContacts)
        ;(filter as Record<string, unknown>)[`#${letter}`] = values
        break
      }

      case 'since':
        filter.since = resolveTimestamp(tag[1])
        break

      case 'until':
        filter.until = resolveTimestamp(tag[1])
        break

      case 'limit':
        filter.limit = parseInt(tag[1], 10)
        break

      case 'search':
        ;(filter as Record<string, unknown>).search = tag[1]
        break

      case 'relays':
        spellRelays = tag.slice(1)
        break

      // Skip metadata tags: cmd, name, alt, t, e, close-on-eose
    }
  }

  if (!filter.limit) filter.limit = 50

  // Step 3: execute the query
  const targetRelays = args.relays ?? spellRelays
  const events = targetRelays?.length
    ? await pool.queryDirect(targetRelays, filter)
    : await pool.query(ctx.activeNpub, filter)

  return {
    spellName,
    filter,
    count: events.length,
    events: events.map(e => ({
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      tags: e.tags,
      content: e.content.length > 500 ? e.content.slice(0, 500) + '...' : e.content,
      created_at: e.created_at,
    })),
  }
}
