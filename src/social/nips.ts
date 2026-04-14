import type { Event as NostrEvent } from 'nostr-tools'
import type { SigningContext } from '../signing-context.js'
import type { RelayPool } from '../relay-pool.js'
import type { PublishResult } from '../types.js'

export interface NipEvent {
  id: string
  pubkey: string
  identifier: string
  title: string
  kinds: number[]
  content: string
  createdAt: number
}

/**
 * Publish a community NIP (kind 30817).
 *
 * @param args.identifier - The `d` tag value — a unique slug for this NIP document.
 * @param args.title - Human-readable title of the NIP.
 * @param args.content - Full NIP body (Markdown).
 * @param args.kinds - Optional list of Nostr event kinds that this NIP governs; each is added as a `k` tag.
 * @param args.relays - Optional explicit relay URLs to publish to.
 * @returns The signed kind 30817 event and publish result.
 * @example
 * const result = await handleNipPublish(ctx, pool, {
 *   identifier: 'nip-commerce-101',
 *   title: 'Commerce over Nostr',
 *   content: '# NIP-Commerce-101\n\nSpec body here.',
 *   kinds: [30817, 30818],
 * })
 */
export async function handleNipPublish(
  ctx: SigningContext,
  pool: RelayPool,
  args: {
    identifier: string
    title: string
    content: string
    kinds?: number[]
    relays?: string[]
  },
): Promise<{ event: NostrEvent; publish: PublishResult }> {
  const tags: string[][] = [
    ['d', args.identifier],
    ['title', args.title],
  ]
  if (args.kinds) {
    for (const k of args.kinds) {
      tags.push(['k', String(k)])
    }
  }

  const sign = ctx.getSigningFunction()
  const event = await sign({
    kind: 30817,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: args.content,
  })
  const publish = args.relays?.length
    ? await pool.publishDirect(args.relays, event)
    : await pool.publish(ctx.activeNpub, event)
  return { event, publish }
}

/**
 * Fetch community NIPs from relays.
 *
 * @param npub - The npub of the identity whose relay list is used for querying.
 * @param args.author - Optional pubkey (hex) to restrict results to a single author.
 * @param args.identifier - Optional `d` tag value to fetch a specific NIP by slug.
 * @param args.kind - Optional event kind number to filter NIPs that govern a particular kind.
 * @returns Array of parsed NIP events, each with `id`, `pubkey`, `identifier`, `title`, `kinds`, `content`, and `createdAt`.
 * @example
 * const nips = await handleNipRead(pool, 'npub1...', { author: 'abc123...' })
 * nips.forEach(n => console.log(n.title, n.identifier))
 */
export async function handleNipRead(
  pool: RelayPool,
  npub: string,
  args: { author?: string; identifier?: string; kind?: number },
): Promise<NipEvent[]> {
  const filter: Record<string, unknown> = { kinds: [30817] }
  if (args.author) filter.authors = [args.author]
  if (args.identifier) filter['#d'] = [args.identifier]
  if (args.kind) filter['#k'] = [String(args.kind)]

  const events = await pool.query(npub, filter as any)

  return events.map(e => {
    const dTag = e.tags.find(t => t[0] === 'd')
    const titleTag = e.tags.find(t => t[0] === 'title')
    const kTags = e.tags.filter(t => t[0] === 'k')
    return {
      id: e.id,
      pubkey: e.pubkey,
      identifier: dTag?.[1] ?? '',
      title: titleTag?.[1] ?? '',
      kinds: kTags.map(t => parseInt(t[1], 10)),
      content: e.content,
      createdAt: e.created_at,
    }
  })
}
