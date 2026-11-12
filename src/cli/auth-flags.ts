/**
 * The NIP-42 mode flags, `--auth` and `--eager-auth`.
 *
 * bray reads them only before the command (`nostr-bray --auth req ...`), so
 * they can be stripped before command detection. After the command they belong
 * to it: `relay curl <url> --auth` means NIP-98, and `serve --auth` makes the
 * test relay require AUTH. Anywhere else a mode flag after the command does
 * nothing, which is easy to miss, so it is reported as misplaced.
 */
export interface AuthFlags {
  /** `on-demand` for a leading --auth, `eager` for a leading --eager-auth. */
  mode?: 'on-demand' | 'eager'
  /** The arguments with the leading mode flags removed. */
  rest: string[]
  /** A mode flag found after a command that has none of its own; it has no effect. */
  misplaced?: '--auth' | '--eager-auth'
}

const isModeFlag = (arg: string | undefined): arg is '--auth' | '--eager-auth' =>
  arg === '--auth' || arg === '--eager-auth'

/** Commands that give --auth / --eager-auth a meaning of their own. */
function ownsModeFlags([command, sub]: string[]): boolean {
  return command === 'serve' || command === 'relay-curl' || (command === 'relay' && sub === 'curl')
}

export function parseAuthFlags(argv: string[]): AuthFlags {
  const rest = [...argv]
  let mode: AuthFlags['mode']
  while (isModeFlag(rest[0])) {
    if (rest[0] === '--eager-auth') mode = 'eager'
    else if (mode !== 'eager') mode = 'on-demand'
    rest.shift()
  }
  const misplaced = ownsModeFlags(rest) ? undefined : rest.slice(1).find(isModeFlag)
  return {
    ...(mode ? { mode } : {}),
    rest,
    ...(misplaced ? { misplaced } : {}),
  }
}
