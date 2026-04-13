import { handleDuressConfigure, handleDuressActivate } from '../../safety/handlers.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { out } = h

  switch (cmd) {
    case 'safety-configure':
      out(await handleDuressConfigure(ctx, pool, { personaName: cmdArgs[1] }))
      break

    case 'safety-activate':
      out(await handleDuressActivate(ctx, { personaName: cmdArgs[1] }))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
