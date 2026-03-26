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
