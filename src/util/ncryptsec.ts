/**
 * NIP-49 ncryptsec — password-encrypted secret keys.
 *
 * Encrypt an nsec with a passphrase for safe storage.
 * Decrypt an ncryptsec back to the raw key.
 */

import { encrypt, decrypt } from 'nostr-tools/nip49'
import { decode } from 'nostr-tools/nip19'
import { getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'

/** Encrypt a secret key (nsec or hex) with a password. Returns ncryptsec string. */
export function handleKeyEncrypt(
  secret: string,
  password: string,
): { ncryptsec: string; pubkeyHex: string; npub: string } {
  let bytes: Uint8Array
  if (secret.startsWith('nsec1')) {
    bytes = decode(secret).data as Uint8Array
  } else {
    bytes = Buffer.from(secret, 'hex')
  }

  try {
    const ncryptsec = encrypt(bytes, password)
    const pubkeyHex = getPublicKey(bytes)
    return { ncryptsec, pubkeyHex, npub: npubEncode(pubkeyHex) }
  } finally {
    bytes.fill(0)
  }
}

/** Decrypt an ncryptsec with a password. Returns the derived pubkey (never the raw key). */
export function handleKeyDecrypt(
  ncryptsec: string,
  password: string,
): { pubkeyHex: string; npub: string } {
  const bytes = decrypt(ncryptsec, password)
  try {
    const pubkeyHex = getPublicKey(bytes)
    return { pubkeyHex, npub: npubEncode(pubkeyHex) }
  } finally {
    bytes.fill(0)
  }
}
