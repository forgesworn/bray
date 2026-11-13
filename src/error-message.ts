/**
 * The text of a thrown or rejected value.
 *
 * Not everything that rejects is an Error. nostr-tools rejects with a bare
 * string when a relay connection times out or fails, and passes a remote
 * signer's NIP-46 `error` field through as a string, so `(e as Error).message`
 * reads `undefined` for exactly the failures a user most needs to see.
 *
 * Only a string ever comes back: a rejected object is never serialised, since
 * its fields could carry request data into a log.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  try {
    return String(e)
  } catch {
    // An object with no prototype has no toString.
    return 'unknown error'
  }
}
