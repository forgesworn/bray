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

/**
 * Encrypt a secret key (nsec or hex) with a password. Returns ncryptsec string.
 *
 * @param secret - The private key as a `nsec1…` bech32 string or a 64-character lowercase hex string.
 * @param password - Passphrase used to derive the encryption key via scrypt (NIP-49).
 * @returns `{ ncryptsec, pubkeyHex, npub }` — the encrypted key blob and the derived public key.
 *   The raw private key is zeroed from memory immediately after use.
 * @example
 * handleKeyEncrypt('nsec1...', 'correct horse battery staple')
 * // { ncryptsec: 'ncryptsec1...', pubkeyHex: '3bf0c6...', npub: 'npub180cvv...' }
 */
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

/**
 * Decrypt an ncryptsec with a password. Returns the derived pubkey (never the raw key).
 *
 * @param ncryptsec - A NIP-49 encrypted key string beginning with `ncryptsec1…`.
 * @param password - Passphrase used to decrypt the key blob.
 * @returns `{ pubkeyHex, npub }` — the public key derived from the decrypted secret.
 *   The raw private key bytes are zeroed from memory immediately after the pubkey is derived.
 * @example
 * handleKeyDecrypt('ncryptsec1...', 'correct horse battery staple')
 * // { pubkeyHex: '3bf0c6...', npub: 'npub180cvv...' }
 */
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
