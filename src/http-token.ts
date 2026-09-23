import { randomUUID } from 'node:crypto'

/**
 * The bearer token the HTTP transport requires.
 *
 * A token the operator supplied in BRAY_HTTP_TOKEN is never echoed: they
 * already have it, and stderr ends up in logs and process supervisors. A
 * generated one is printed once, because nobody else can know it.
 */
export function resolveHttpToken(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = (message) => console.error(message),
): string {
  const supplied = env.BRAY_HTTP_TOKEN?.trim()
  if (supplied) {
    log('nostr-bray HTTP auth: using the token from BRAY_HTTP_TOKEN')
    return supplied
  }
  const generated = randomUUID()
  log(`nostr-bray HTTP auth token: ${generated}`)
  return generated
}
