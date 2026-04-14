import { handleSyncPull, handleSyncPush } from '../../exports.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  _ctx: any,
  pool: any,
  activeNpub: string,
): Promise<void> {
  const { req, flag, out } = h

  switch (cmd) {
    case 'sync-pull': {
      const relay = req(1, 'sync pull <relay-url> [--kinds N] [--authors hex] [--since ts] [--limit N]')
      const kindsRaw = flag('kinds')
      const authorsRaw = flag('authors')
      const since = flag('since') ? parseInt(flag('since')!, 10) : undefined
      const limit = flag('limit') ? parseInt(flag('limit')!, 10) : undefined

      out(await handleSyncPull(pool, activeNpub, {
        relay,
        kinds: kindsRaw ? kindsRaw.split(',').map(Number) : undefined,
        authors: authorsRaw ? authorsRaw.split(',') : undefined,
        since,
        limit,
      }), d => `Pulled ${d.count} event(s) from ${d.relay}`)
      break
    }

    case 'sync-push': {
      const relay = req(1, 'sync push <relay-url> --events <jsonl-file>')
      const eventsFile = flag('events')
      if (!eventsFile) throw new Error('sync push requires --events <jsonl-file>')

      out(await handleSyncPush(pool, { relay, eventsFile }),
        d => `Pushed to ${d.relay}: ${d.succeeded} succeeded, ${d.failed} failed (${d.attempted} attempted)`)
      break
    }

    default:
      throw new Error(`Unknown sync subcommand: ${cmd}. Use: sync pull, sync push`)
  }
}
