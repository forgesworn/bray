import { handleAdminCall, coerceAdminParams, resolveAdminMethod, ADMIN_METHOD_ALIASES } from '../../exports.js'
import type { AdminMethod } from '../../exports.js'
import type { Helpers } from '../dispatch.js'

export const ADMIN_METHODS = new Set<AdminMethod>([
  'supportedmethods',
  'allowpubkey', 'unallowpubkey', 'banpubkey', 'unbanpubkey',
  'listallowedpubkeys', 'listbannedpubkeys',
  'allowkind', 'disallowkind', 'listallowedkinds', 'listdisallowedkinds',
  'allowevent', 'banevent', 'listbannedevents', 'listeventsneedingmoderation',
  'changerelayname', 'changerelaydescription', 'changerelayicon',
  'createrole', 'editrole', 'deleterole', 'assignrole', 'unassignrole',
  'grantadmin', 'revokeadmin',
  'blockip', 'unblockip', 'listblockedips',
])

/** Legacy subcommand spellings still accepted on the CLI. */
export const ADMIN_ALIASES = Object.keys(ADMIN_METHOD_ALIASES)

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
): Promise<void> {
  // cmd is always 'admin'; subcommand is cmdArgs[1] (already sliced by normaliser)
  // After COMPOUND_COMMANDS normalisation: cmd = 'admin-<subcommand>'
  const { req, out } = h

  // Extract the method from the compound command name, mapping legacy spellings.
  // A bare `admin` means the subcommand was not recognised during normalisation.
  const requested = cmd === 'admin' ? (cmdArgs[1] ?? '') : cmd.replace(/^admin-/, '')
  const method = resolveAdminMethod(requested)

  if (!requested || !ADMIN_METHODS.has(method)) {
    throw new Error(
      `${requested ? `Unknown admin subcommand: ${requested}.` : 'admin needs a subcommand.'}\n` +
      `Usage: admin <subcommand> <relay-url> [param...]\n` +
      `Valid: ${[...ADMIN_METHODS].join(', ')}`
    )
  }

  if (requested !== method) {
    console.error(`note: "admin ${requested}" is not a NIP-86 method name; sending "${method}" instead`)
  }

  const relay = req(1, `admin ${method} <relay-url> [param...]`)
  // Remaining positional args after relay URL are method params
  const params = cmdArgs.slice(2).filter(a => !a.startsWith('--'))
  const coercedParams = coerceAdminParams(method, params)

  out(await handleAdminCall(ctx, {
    relay,
    method,
    params: coercedParams.length ? coercedParams : undefined,
  }), d => `${d.method} on ${d.relay}: ${JSON.stringify(d.result)}`)
}
