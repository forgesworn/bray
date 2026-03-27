/**
 * Widget handler for the identity picker. Calls existing handleIdentityList,
 * enriches identities with profile images fetched server-side.
 */

import { decode } from 'nostr-tools/nip19'
import type { IdentityContext } from '../context.js'
import type { RelayPool } from '../relay-pool.js'
import { handleIdentityList } from '../identity/handlers.js'
import { handleSocialProfileGet } from '../social/handlers.js'
import { fetchProfileImage } from './profile-images.js'

export interface IdentityPickerEntry {
  npub: string
  personaName?: string
  displayName?: string
  pictureDataUri?: string
  isActive: boolean
}

export interface IdentityPickerResult {
  identities: IdentityPickerEntry[]
  activeNpub: string
}

export async function handleIdentityPickerWidget(
  ctx: IdentityContext,
  pool: RelayPool,
): Promise<IdentityPickerResult> {
  const identities = handleIdentityList(ctx)
  const activeNpub = ctx.activeNpub

  const entries: IdentityPickerEntry[] = []

  for (const id of identities) {
    let displayName: string | undefined
    let pictureDataUri: string | undefined

    try {
      const pubkeyHex = decode(id.npub).data as string
      const profile = await handleSocialProfileGet(pool, activeNpub, pubkeyHex)
      displayName = (profile?.display_name as string) || (profile?.name as string) || undefined
      const picture = profile?.picture as string | undefined
      if (picture) {
        pictureDataUri = await fetchProfileImage(picture)
      }
    } catch { /* profile lookup may fail for new identities */ }

    entries.push({
      npub: id.npub,
      personaName: id.personaName,
      displayName,
      pictureDataUri,
      isActive: id.npub === activeNpub,
    })
  }

  return { identities: entries, activeNpub }
}
