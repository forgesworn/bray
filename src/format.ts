/** Human-readable formatters for CLI output */

import type { PublicIdentity } from './types.js'

export function formatIdentity(id: PublicIdentity): string {
  let line = `${id.npub}`
  if (id.personaName) line += `  (persona: ${id.personaName})`
  else if (id.purpose) line += `  (${id.purpose}${id.index ? ` #${id.index}` : ''})`
  return line
}

export function formatIdentityList(ids: PublicIdentity[]): string {
  if (ids.length === 0) return 'No identities found.'
  const lines = ids.map((id, i) => {
    const marker = i === 0 ? '* ' : '  '
    return `${marker}${formatIdentity(id)}`
  })
  return lines.join('\n')
}

export function formatPost(result: any): string {
  const status = result.publish?.success ? '✓' : '✗'
  return `${status} ${result.event?.id?.slice(0, 12)}... published to ${result.publish?.accepted?.length ?? 0} relay(s)`
}

export function formatPublish(result: any): string {
  const status = result.publish?.success ? '✓ Published' : '✗ Failed'
  const relays = result.publish?.accepted?.length ?? 0
  return `${status} (${relays} relay${relays !== 1 ? 's' : ''})`
}

export function formatProfile(profile: Record<string, unknown>): string {
  if (Object.keys(profile).length === 0) return 'No profile found.'
  const lines: string[] = []
  if (profile.name) lines.push(`Name:    ${profile.name}`)
  if (profile.display_name) lines.push(`Display: ${profile.display_name}`)
  if (profile.about) lines.push(`About:   ${profile.about}`)
  if (profile.nip05) lines.push(`NIP-05:  ${profile.nip05}`)
  if (profile.lud16) lines.push(`LN:      ${profile.lud16}`)
  if (profile.picture) lines.push(`Picture: ${profile.picture}`)
  if (profile.banner) lines.push(`Banner:  ${profile.banner}`)
  return lines.join('\n')
}

export function formatContacts(contacts: Array<{ pubkey: string; relay?: string; petname?: string }>): string {
  if (contacts.length === 0) return 'No contacts found.'
  const lines = contacts.map(c => {
    let line = c.pubkey.slice(0, 12) + '...'
    if (c.petname) line += `  ${c.petname}`
    if (c.relay) line += `  (${c.relay})`
    return line
  })
  return `${contacts.length} contacts:\n${lines.join('\n')}`
}

export function formatContactSearch(contacts: Array<{ pubkey: string; name?: string; displayName?: string; nip05?: string; petname?: string }>): string {
  if (contacts.length === 0) return 'No matching contacts.'
  const lines = contacts.map(c => {
    const label = c.displayName || c.name || c.petname || c.pubkey.slice(0, 12) + '...'
    const parts = [label]
    if (c.name && c.displayName && c.name !== c.displayName) parts.push(`(@${c.name})`)
    else if (c.name && !c.displayName) parts.push(`(@${c.name})`)
    if (c.nip05) parts.push(`[${c.nip05}]`)
    parts.push(c.pubkey.slice(0, 12) + '...')
    return parts.join('  ')
  })
  return `${contacts.length} match${contacts.length !== 1 ? 'es' : ''}:\n${lines.join('\n')}`
}

export function formatNotifications(notifications: any[]): string {
  if (notifications.length === 0) return 'No notifications.'
  return notifications.map(n => {
    const time = new Date(n.createdAt * 1000).toLocaleString()
    const from = n.from?.slice(0, 12) + '...'
    switch (n.type) {
      case 'reply':
        return `💬 ${from} replied: ${n.content?.slice(0, 80)}  (${time})`
      case 'reaction':
        return `${n.content === '+' ? '❤️' : n.content} ${from} reacted  (${time})`
      case 'mention':
        return `@  ${from} mentioned you: ${n.content?.slice(0, 80)}  (${time})`
      case 'zap':
        const sats = n.amountMsats ? `${Math.round(n.amountMsats / 1000)} sats` : 'zap'
        return `⚡ ${n.zapSender?.slice(0, 12) ?? from}... zapped ${sats}${n.zapMessage ? `: ${n.zapMessage}` : ''}  (${time})`
      default:
        return `${n.type} from ${from}  (${time})`
    }
  }).join('\n')
}

export function formatFeed(events: any[]): string {
  if (events.length === 0) return 'No posts found.'
  return events.map(e => {
    const time = new Date(e.createdAt * 1000).toLocaleString()
    const author = e.pubkey?.slice(0, 12) + '...'
    return `${author}  ${time}\n  ${e.content?.slice(0, 200)}\n`
  }).join('\n')
}

export function formatConversation(dms: any[]): string {
  if (dms.length === 0) return 'No messages in this conversation.'
  return dms.map(dm => {
    const time = new Date(dm.createdAt * 1000).toLocaleString()
    const from = dm.from?.slice(0, 12) + '...'
    if (!dm.decrypted) return `✗ ${from}  Could not decrypt  (${time})`
    return `${from}  ${time}\n  ${dm.content}`
  }).join('\n\n')
}

export function formatDms(dms: any[]): string {
  if (dms.length === 0) return 'No messages.'
  return dms.map(dm => {
    const time = new Date(dm.createdAt * 1000).toLocaleString()
    const from = dm.from?.slice(0, 12) + '...'
    const proto = dm.protocol === 'nip04-deprecated' ? ' [NIP-04]' : ''
    if (!dm.decrypted) return `✗ ${from}  Could not decrypt${proto}  (${time})`
    return `${from}${proto}  ${time}\n  ${dm.content}`
  }).join('\n\n')
}

export function formatRelays(relays: { read: string[]; write: string[]; sharedWarning?: string }): string {
  const lines: string[] = []
  if (relays.read.length > 0) {
    lines.push('Read:')
    relays.read.forEach(r => lines.push(`  ${r}`))
  }
  if (relays.write.length > 0) {
    lines.push('Write:')
    relays.write.forEach(r => lines.push(`  ${r}`))
  }
  if (relays.sharedWarning) lines.push(`\n⚠️  ${relays.sharedWarning}`)
  return lines.join('\n')
}

export function formatZapReceipts(receipts: any[]): string {
  if (receipts.length === 0) return 'No zap receipts.'
  return receipts.map(r => {
    const time = new Date(r.createdAt * 1000).toLocaleString()
    const sats = r.amountMsats ? `${Math.round(r.amountMsats / 1000)} sats` : '? sats'
    const from = r.sender ? r.sender.slice(0, 12) + '...' : 'unknown'
    return `⚡ ${sats} from ${from}${r.message ? ` — ${r.message}` : ''}  (${time})`
  }).join('\n')
}

export function formatGroupChat(messages: any[]): string {
  if (messages.length === 0) return 'No messages.'
  return messages.map(m => {
    const time = new Date(m.createdAt * 1000).toLocaleString()
    const author = m.pubkey?.slice(0, 12) + '...'
    return `${author}  ${time}\n  ${m.content}`
  }).join('\n\n')
}

export function formatNipList(nips: Array<{ number: number; title: string }>): string {
  return nips.map(n => `NIP-${String(n.number).padStart(2, '0')}  ${n.title}`).join('\n')
}

export function formatDecode(result: { type: string; data: unknown }): string {
  const lines = [`Type: ${result.type}`]
  if (typeof result.data === 'string') {
    lines.push(`Data: ${result.data}`)
  } else if (typeof result.data === 'object' && result.data !== null) {
    for (const [k, v] of Object.entries(result.data as Record<string, unknown>)) {
      if (Array.isArray(v)) lines.push(`${k}: ${v.join(', ')}`)
      else lines.push(`${k}: ${v}`)
    }
  }
  return lines.join('\n')
}

// --- Article formatters ---

export function formatArticle(articles: any[]): string {
  if (articles.length === 0) return 'No articles found.'
  return articles.map(a => {
    const time = a.publishedAt ? new Date(a.publishedAt * 1000).toLocaleString() : 'unknown'
    const lines = [`# ${a.title}`]
    if (a.slug) lines.push(`Slug: ${a.slug}`)
    lines.push(`Published: ${time}`)
    if (a.summary) lines.push(`Summary: ${a.summary}`)
    if (a.hashtags?.length > 0) lines.push(`Tags: ${a.hashtags.join(', ')}`)
    if (a.image) lines.push(`Image: ${a.image}`)
    lines.push('')
    lines.push(a.content)
    return lines.join('\n')
  }).join('\n\n---\n\n')
}

export function formatArticleList(articles: any[]): string {
  if (articles.length === 0) return 'No articles found.'
  return articles.map(a => {
    const time = a.publishedAt ? new Date(a.publishedAt * 1000).toLocaleString() : 'unknown'
    const parts = [a.title || '(untitled)']
    if (a.slug) parts.push(`[${a.slug}]`)
    parts.push(`(${time})`)
    if (a.summary) parts.push(`— ${a.summary}`)
    return parts.join('  ')
  }).join('\n')
}

// --- Dispatch formatters ---

export function formatDispatchSendResult(result: any): string {
  if (!result.sent) return `Failed to send ${result.messageType} to ${result.recipientName}`
  return `Sent ${result.messageType} (${result.taskId}) to ${result.recipientName}\nRelays: ${result.publish.accepted.join(', ') || 'none accepted'}`
}

export function formatDispatchMessages(messages: any[]): string {
  if (messages.length === 0) return 'No dispatch messages.'
  return messages.map(m => {
    const time = new Date(m.createdAt * 1000).toLocaleString()
    const name = m.fromName || m.from.slice(0, 12) + '...'
    const msg = m.message
    switch (msg.type) {
      case 'dispatch-think': {
        const thinkDeps = msg.depends_on?.length ? `\n  Depends on: ${msg.depends_on.join(', ')}` : ''
        return `Think task from ${name}: ${msg.prompt?.slice(0, 80) ?? ''}\n  Repos: ${(msg.repos ?? []).join(', ')}  Respond to: ${msg.respond_to?.slice(0, 12) ?? '?'}  (${time})\n  Task ID: ${msg.id}  Event ID: ${m.eventId}${thinkDeps}`
      }
      case 'dispatch-build': {
        const buildDeps = msg.depends_on?.length ? `\n  Depends on: ${msg.depends_on.join(', ')}` : ''
        return `Build task from ${name}: ${msg.prompt?.slice(0, 80) ?? ''}\n  Repos: ${(msg.repos ?? []).join(', ')}  Branch from: ${msg.branch_from ?? 'main'}  (${time})\n  Task ID: ${msg.id}  Event ID: ${m.eventId}${buildDeps}`
      }
      case 'dispatch-result': {
        const payload = msg.plan || msg.tests || ''
        return `Result from ${name} for ${msg.re?.slice(0, 12) ?? '?'} (${msg.mode ?? '?'}):\n  ${String(payload).slice(0, 200)}  (${time})`
      }
      case 'dispatch-status':
        return `Status from ${name}: ${msg.status} — ${msg.note ?? ''}  (${time})`
      case 'dispatch-ack':
        return `Ack from ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.note ?? ''}  (${time})`
      case 'dispatch-cancel':
        return `Cancel from ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.note ?? ''}  (${time})`
      case 'dispatch-refuse':
        return `Refused by ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.reason ?? ''}  (${time})`
      case 'dispatch-failure':
        return `Failed from ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.error ?? ''}\n  Partial: ${msg.partial?.slice(0, 200) ?? 'none'}  (${time})`
      case 'dispatch-query':
        return `Question from ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.question ?? ''}  (${time})`
      case 'dispatch-propose':
        return `Proposal from ${name} for ${msg.re?.slice(0, 12) ?? '?'}: ${msg.proposal}\n  Reason: ${msg.reason ?? 'none'}  (${time})`
      default:
        return `${(msg as any).type} from ${name}  (${time})`
    }
  }).join('\n\n')
}

export function formatSearchResults(notes: any[]): string {
  if (notes.length === 0) return 'No matching notes found.'
  return notes.map(n => {
    const time = new Date(n.createdAt * 1000).toLocaleString()
    const author = n.pubkey?.slice(0, 12) + '...'
    const tags = n.hashtags?.length ? `  [${n.hashtags.join(', ')}]` : ''
    return `${author}  ${time}${tags}\n  ${n.content?.slice(0, 200)}\n`
  }).join('\n')
}

export function formatProfileSearchResults(profiles: any[]): string {
  if (profiles.length === 0) return 'No matching profiles found.'
  return profiles.map(p => {
    const label = p.display_name || p.name || p.pubkey?.slice(0, 12) + '...'
    const parts = [label]
    if (p.name && p.display_name && p.name !== p.display_name) parts.push(`(@${p.name})`)
    else if (p.name && !p.display_name) parts.push(`(@${p.name})`)
    if (p.nip05) parts.push(`[${p.nip05}]`)
    parts.push(p.pubkey?.slice(0, 12) + '...')
    if (p.about) parts.push(`\n  ${p.about.slice(0, 120)}`)
    return parts.join('  ')
  }).join('\n')
}

// --- Calendar formatters ---

export function formatCalendarEvents(events: any[]): string {
  if (events.length === 0) return 'No calendar events found.'
  return events.map(e => {
    const lines = [`# ${e.title}`]
    if (e.slug) lines.push(`Slug: ${e.slug}`)
    lines.push(`Kind: ${e.kind === 31922 ? 'date-based (31922)' : 'time-based (31923)'}`)
    lines.push(`Start: ${e.start}`)
    if (e.end) lines.push(`End: ${e.end}`)
    if (e.location) lines.push(`Location: ${e.location}`)
    if (e.geohash) lines.push(`Geohash: ${e.geohash}`)
    if (e.image) lines.push(`Image: ${e.image}`)
    if (e.participants?.length > 0) lines.push(`Participants: ${e.participants.map((p: string) => p.slice(0, 12) + '...').join(', ')}`)
    if (e.hashtags?.length > 0) lines.push(`Tags: ${e.hashtags.join(', ')}`)
    if (e.content) { lines.push(''); lines.push(e.content) }
    return lines.join('\n')
  }).join('\n\n---\n\n')
}

export function formatRsvp(result: any): string {
  const status = result.publish?.success ? '✓' : '✗'
  const rsvpStatus = result.event?.tags?.find((t: string[]) => t[0] === 'status')?.[1] ?? 'unknown'
  const coord = result.event?.tags?.find((t: string[]) => t[0] === 'a')?.[1] ?? 'unknown'
  return `${status} RSVP ${rsvpStatus} for ${coord}`
}

// --- Listing formatters ---

export function formatListings(listings: any[]): string {
  if (listings.length === 0) return 'No listings found.'
  return listings.map(l => {
    const lines = [`# ${l.title}`]
    if (l.slug) lines.push(`Slug: ${l.slug}`)
    if (l.price) {
      const freq = l.price.frequency ? ` ${l.price.frequency}` : ''
      lines.push(`Price: ${l.price.amount} ${l.price.currency}${freq}`)
    }
    if (l.location) lines.push(`Location: ${l.location}`)
    if (l.summary) lines.push(`Summary: ${l.summary}`)
    if (l.hashtags?.length > 0) lines.push(`Tags: ${l.hashtags.join(', ')}`)
    if (l.image) lines.push(`Image: ${l.image}`)
    if (l.status) lines.push(`Status: ${l.status}`)
    const time = l.publishedAt ? new Date(l.publishedAt * 1000).toLocaleString() : 'unknown'
    lines.push(`Published: ${time}`)
    if (l.content) {
      lines.push('')
      lines.push(l.content)
    }
    return lines.join('\n')
  }).join('\n\n---\n\n')
}

export function formatCapabilities(cards: any[]): string {
  if (cards.length === 0) return 'No dispatch-capable agents found.'
  return cards.map(c => {
    const lines = [`${c.name}  (${c.pubkey?.slice(0, 12)}...)`]
    if (c.description) lines.push(`  ${c.description}`)
    lines.push(`  Tasks: ${(c.taskTypes ?? []).join(', ')}`)
    if (c.repos?.length > 0) lines.push(`  Repos: ${c.repos.join(', ')}`)
    lines.push(`  Status: ${c.availability ?? 'unknown'}`)
    if (c.maxDepth !== undefined) lines.push(`  Max depth: ${c.maxDepth}`)
    if (c.slug) lines.push(`  Slug: ${c.slug}`)
    return lines.join('\n')
  }).join('\n\n')
}

// --- Badge formatters ---

export function formatBadges(badges: any[]): string {
  if (badges.length === 0) return 'No badges found.'
  return badges.map(b => {
    if (b.badgeCoord) {
      return `Badge: ${b.badgeCoord}\n  Award: ${b.awardEventId ?? 'unknown'}`
    }
    const lines = [`${b.name ?? b.slug ?? 'Unnamed badge'}`]
    if (b.description) lines.push(`  ${b.description}`)
    if (b.image) lines.push(`  Image: ${b.image}`)
    if (b.slug) lines.push(`  Slug: ${b.slug}`)
    return lines.join('\n')
  }).join('\n\n')
}

// --- Community formatters ---

export function formatCommunities(communities: any[]): string {
  if (communities.length === 0) return 'No communities found.'
  return communities.map(c => {
    const lines = [`# ${c.name}`]
    if (c.description) lines.push(`  ${c.description}`)
    if (c.image) lines.push(`  Image: ${c.image}`)
    if (c.rules) lines.push(`  Rules: ${c.rules}`)
    if (c.moderators?.length > 0) lines.push(`  Moderators: ${c.moderators.map((m: string) => m.slice(0, 12) + '...').join(', ')}`)
    lines.push(`  Created by: ${c.pubkey?.slice(0, 12) ?? 'unknown'}...`)
    return lines.join('\n')
  }).join('\n\n')
}

export function formatCommunityFeed(posts: any[]): string {
  if (posts.length === 0) return 'No approved posts.'
  return posts.map(p => {
    const time = p.created_at ? new Date(p.created_at * 1000).toLocaleString() : 'unknown'
    const author = p.pubkey?.slice(0, 12) ?? 'unknown'
    return `${author}... (${time}):\n  ${p.content?.slice(0, 200) ?? ''}`
  }).join('\n\n')
}

// --- Wiki formatters ---

export function formatWikiArticles(articles: any[]): string {
  if (articles.length === 0) return 'No wiki articles found.'
  return articles.map(a => {
    const time = a.created_at ? new Date(a.created_at * 1000).toLocaleString() : 'unknown'
    const author = a.pubkey?.slice(0, 12) + '...'
    const lines = [`# ${a.title}`]
    lines.push(`Topic: ${a.topic}`)
    lines.push(`Author: ${author}`)
    lines.push(`Updated: ${time}`)
    if (a.summary) lines.push(`Summary: ${a.summary}`)
    if (a.hashtags?.length > 0) lines.push(`Tags: ${a.hashtags.join(', ')}`)
    lines.push('')
    lines.push(a.content)
    return lines.join('\n')
  }).join('\n\n---\n\n')
}

export function formatWikiList(topics: any[]): string {
  if (topics.length === 0) return 'No wiki topics found.'
  return topics.map(t => {
    const time = t.created_at ? new Date(t.created_at * 1000).toLocaleString() : 'unknown'
    const parts = [t.title || t.topic || '(untitled)']
    if (t.topic) parts.push(`[${t.topic}]`)
    parts.push(`(${time})`)
    if (t.summary) parts.push(`— ${t.summary}`)
    return parts.join('  ')
  }).join('\n')
}

export function formatScheduleResult(result: any): string {
  const time = new Date(result.scheduledAt * 1000).toISOString()
  return `Scheduled ${result.eventId.slice(0, 12)}... for ${time}`
}

export function formatScheduledQueue(entries: any[]): string {
  if (entries.length === 0) return 'No scheduled posts.'
  return entries.map(e => {
    const time = new Date(e.scheduledAt * 1000).toISOString()
    const preview = e.content.length > 60 ? e.content.slice(0, 60) + '...' : e.content
    return `${time}  kind:${e.kind}  ${e.eventId.slice(0, 12)}...  ${preview}`
  }).join('\n')
}

export function formatDispatchReplyResult(result: any): string {
  const del = result.deleted ? ' (original message deleted)' : ''
  return `Sent ${result.messageType}${del}`
}
