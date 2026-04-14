import { handleRelayInfo, handleRelayList, handleRelaySet, handleRelayAdd, handleRelayQuery, handleRelayCurl, handleSubscribe, handleOutboxRelays, handleOutboxPublish } from '../../exports.js'
import * as fmt from '../../format.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
  _activeNpub?: string,
): Promise<void> {
  const { req, flag, flags, hasFlag, out } = h

  switch (cmd) {
    case 'relay-list':
      out(await handleRelayList(ctx, pool, flag('compare')), fmt.formatRelays)
      break

    case 'relay-set': {
      const urls = cmdArgs.slice(1).filter(a => !a.startsWith('--'))
      out(await handleRelaySet(ctx, pool, {
        relays: urls.map(u => ({ url: u })),
        confirm: hasFlag('confirm'),
      }))
      break
    }

    case 'relay-add':
      out(handleRelayAdd(ctx, pool, {
        url: req(1, 'relay-add <url> [read|write]'),
        mode: cmdArgs[2] as 'read' | 'write' | undefined,
      }))
      break

    case 'relay-info':
      out(await handleRelayInfo(req(1, 'relay-info <wss://url>')))
      break

    case 'req': {
      // Support JSON filter on stdin when stdin is a pipe
      let stdinFilter: Record<string, unknown> | undefined
      const isTTY = process.stdin.isTTY
      if (!isTTY) {
        const { readFileSync } = await import('node:fs')
        const raw = readFileSync(0, 'utf-8').trim()
        if (raw) stdinFilter = JSON.parse(raw)
      }

      const kindsRaw = flag('kinds')
      const authorsRaw = flag('authors')
      const since = flag('since') ? parseInt(flag('since')!, 10) : undefined
      const until = flag('until') ? parseInt(flag('until')!, 10) : undefined
      const limit = flag('limit') ? parseInt(flag('limit')!, 10) : undefined
      const search = flag('search')
      const relayOverrides = flags('relay')

      const tagEntries = flags('tag')
      const tags: Record<string, string[]> = {}
      for (const t of tagEntries) {
        const eq = t.indexOf('=')
        if (eq !== -1) {
          const k = t.slice(0, eq)
          const v = t.slice(eq + 1)
          if (!tags[k]) tags[k] = []
          tags[k].push(v)
        }
      }

      const queryArgs = stdinFilter ?? {
        ...(kindsRaw ? { kinds: kindsRaw.split(',').map(Number) } : {}),
        ...(authorsRaw ? { authors: authorsRaw.split(',') } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(search ? { search } : {}),
        ...(Object.keys(tags).length ? { tags } : {}),
        ...(relayOverrides.length ? { relays: relayOverrides } : {}),
      }

      const events = await handleRelayQuery(pool, ctx.activeNpub, queryArgs as any)

      const jsonl = hasFlag('jsonl') || (!process.stdout.isTTY && !cmdArgs.includes('--json'))
      if (jsonl) {
        for (const ev of events) console.log(JSON.stringify(ev))
      } else {
        out(events)
      }
      break
    }

    case 'relay-curl': {
      const relay = req(1, 'relay curl <relay-url> [--path /endpoint] [--method GET|POST] [--body json] [--auth]')
      const path = flag('path')
      const method = (flag('method') ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE'
      const body = flag('body')
      const useAuth = hasFlag('auth')

      out(await handleRelayCurl(useAuth ? ctx : null, { relay, path, method, body, auth: useAuth }),
        d => {
          const lines = [`HTTP ${d.status} ${d.url}`]
          if (typeof d.body === 'string') lines.push(d.body)
          else lines.push(JSON.stringify(d.body, null, 2))
          return lines.join('\n')
        })
      break
    }

    case 'subscribe': {
      const kindsRaw = flag('kinds')
      const authorsRaw = flag('authors')
      const since = flag('since') ? parseInt(flag('since')!, 10) : undefined
      const until = flag('until') ? parseInt(flag('until')!, 10) : undefined
      const limit = flag('limit') ? parseInt(flag('limit')!, 10) : undefined
      const relayOverrides = flags('relay')

      const filter = {
        ...(kindsRaw ? { kinds: kindsRaw.split(',').map(Number) } : {}),
        ...(authorsRaw ? { authors: authorsRaw.split(',') } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(until !== undefined ? { until } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }

      const unsubscribe = await handleSubscribe(
        pool,
        ctx.activeNpub,
        filter,
        (event: any) => process.stdout.write(JSON.stringify(event) + '\n'),
        relayOverrides.length ? relayOverrides : undefined,
      )

      // Run until SIGINT
      await new Promise<void>(resolve => {
        process.once('SIGINT', () => { unsubscribe(); resolve() })
      })
      break
    }

    case 'outbox-relays': {
      const targetPubkey = req(1, 'outbox relays <npub|hex|nprofile>')
      const result = await handleOutboxRelays(ctx, pool, { targetPubkey })
      out(result, r => {
        const lines = [
          `pubkey:   ${r.pubkey}`,
          `resolved: ${r.resolved ? 'yes (kind 10002 found)' : 'no (using defaults)'}`,
          `read:     ${r.relays.read.join(', ') || '(none)'}`,
          `write:    ${r.relays.write.join(', ') || '(none)'}`,
        ]
        return lines.join('\n')
      })
      break
    }

    case 'outbox-publish': {
      const { readFileSync } = await import('node:fs')
      const filePath = cmdArgs[1]
      let raw: string
      if (filePath && filePath !== '-') {
        raw = readFileSync(filePath, 'utf-8').trim()
      } else {
        raw = readFileSync(0, 'utf-8').trim()
      }
      const event = JSON.parse(raw)
      const timeoutMs = flag('timeout') ? parseInt(flag('timeout')!, 10) : undefined
      const result = await handleOutboxPublish(ctx, pool, { event, timeoutMs })
      out(result, r => {
        const lines = [
          `event:    ${r.event.id}`,
          `relays:   ${r.targetRelays.join(', ')}`,
          `success:  ${r.publish.success}`,
          `accepted: ${r.publish.relayResults?.filter((x: any) => x.accepted).length ?? '?'}/${r.publish.relayResults?.length ?? '?'}`,
        ]
        return lines.join('\n')
      })
      break
    }

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
