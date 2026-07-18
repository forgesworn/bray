import { handleSyncPlan, handleSyncPull, handleSyncPush } from '../../exports.js'
import type { SyncPlanOptions, SyncProtocolPreference } from '../../sync/handlers.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  _ctx: any,
  pool: any,
  activeNpub: string,
): Promise<void> {
  const { req, flag, hasFlag, out } = h
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)

  const optionalInteger = (name: string): number | undefined => {
    const value = flag(name)
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`)
    return parsed
  }
  const common = (relay: string): SyncPlanOptions => {
    const kindsRaw = flag('kinds')
    const authorsRaw = flag('authors')
    return {
      relay,
      eventsFile: flag('events'),
      kinds: kindsRaw ? kindsRaw.split(',').map(Number) : undefined,
      authors: authorsRaw ? authorsRaw.split(',') : undefined,
      since: optionalInteger('since'),
      until: optionalInteger('until'),
      maxIds: optionalInteger('max-ids') ?? optionalInteger('limit'),
      maxRemoteEvents: optionalInteger('max-remote'),
      timeoutMs: optionalInteger('timeout'),
      protocol: (flag('protocol') as SyncProtocolPreference | undefined) ?? 'auto',
      signal: controller.signal,
    }
  }

  try {
    switch (cmd) {
      case 'sync-plan': {
        const relay = req(1, 'sync plan <relay-url> [--events file|-] [--kinds N,N] [--authors hex]')
        const result = await handleSyncPlan(pool, common(relay))
        out(result, data =>
          `${data.protocol}: ${data.localOnlyCount} local-only, ${data.remoteOnlyCount} remote-only` +
          `${data.complete ? '' : ' (incomplete fallback scan)'}${data.truncated ? ' (output truncated)' : ''}`,
        )
        break
      }

      case 'sync-pull': {
        const relay = req(1, 'sync pull <relay-url> [--events file|-] [--kinds N,N] [--authors hex]')
        const result = await handleSyncPull(pool, activeNpub, common(relay))
        if (hasFlag('jsonl')) {
          out([
            { type: 'sync-plan', ...result.plan },
            ...result.events.map(event => ({ type: 'event', event })),
          ])
        } else {
          out(result, data =>
            `Pulled ${data.count} event(s) from ${data.relay} after ${data.protocol} reconciliation` +
            `${data.transferComplete ? '' : ' (bounded/incomplete transfer)'}`,
          )
        }
        break
      }

      case 'sync-push': {
        const relay = req(1, 'sync push <relay-url> --events <jsonl-file|->')
        const opts = common(relay)
        if (!opts.eventsFile) throw new Error('sync push requires --events <jsonl-file|->')
        const result = await handleSyncPush(pool, opts)
        if (hasFlag('jsonl')) {
          out([
            { type: 'sync-plan', ...result.plan },
            ...result.results.map(entry => ({ type: 'publish', ...entry })),
            {
              type: 'summary',
              relay: result.relay,
              protocol: result.protocol,
              attempted: result.attempted,
              succeeded: result.succeeded,
              failed: result.failed,
              transferComplete: result.transferComplete,
            },
          ])
        } else {
          out(result, data =>
            `Pushed to ${data.relay} after ${data.protocol} reconciliation: ` +
            `${data.succeeded} succeeded, ${data.failed} failed (${data.attempted} attempted)` +
            `${data.transferComplete ? '' : ' (bounded/incomplete transfer)'}`,
          )
        }
        break
      }

      default:
        throw new Error(`Unknown sync subcommand: ${cmd}. Use: sync plan, sync pull, sync push`)
    }
  } finally {
    process.removeListener('SIGINT', cancel)
  }
}
