import { handleAdminCall } from '../../exports.js'
import type { AdminMethod } from '../../exports.js'
import type { Helpers } from '../dispatch.js'

const ADMIN_METHODS = new Set<AdminMethod>([
  'allowpubkey', 'banpubkey', 'listallowedpubkeys', 'listbannedpubkeys',
  'allowkind', 'bankind', 'listallowedkinds', 'listbannedkinds',
  'blockip', 'unblockip', 'listblockedips',
])

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
): Promise<void> {
  // cmd is always 'admin'; subcommand is cmdArgs[1] (already sliced by normaliser)
  // After COMPOUND_COMMANDS normalisation: cmd = 'admin-<subcommand>'
  const { req, out } = h

  // Extract the method from the compound command name
  const method = cmd.replace(/^admin-/, '') as AdminMethod

  if (!ADMIN_METHODS.has(method)) {
    throw new Error(
      `Unknown admin subcommand: ${method}. Valid: ${[...ADMIN_METHODS].join(', ')}`
    )
  }

  const relay = req(1, `admin ${method} <relay-url> [param...]`)
  // Remaining positional args after relay URL are method params
  const params = cmdArgs.slice(2).filter(a => !a.startsWith('--'))

  // allowkind / bankind take integer params
  const coercedParams: Array<string | number> = params.map(p => {
    const n = Number(p)
    return isNaN(n) ? p : n
  })

  out(await handleAdminCall(ctx, {
    relay,
    method,
    params: coercedParams.length ? coercedParams : undefined,
  }), d => `${d.method} on ${d.relay}: ${JSON.stringify(d.result)}`)
}
