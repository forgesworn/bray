import { handlePublishEvent, handlePublishRaw } from '../../exports.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { flag, flags, hasFlag, out } = h

  switch (cmd) {
    case 'event': {
      const kind = parseInt(flag('kind') ?? '', 10)
      if (!kind || isNaN(kind)) throw new Error('Usage: event --kind <N> [--tag k=v] [--content s] [--relay url] [--no-publish]')
      const tagValues = flags('tag').map(t => {
        const eq = t.indexOf('=')
        if (eq === -1) return [t]
        return [t.slice(0, eq), t.slice(eq + 1)]
      })
      const content = flag('content') ?? ''
      const relayOverrides = flags('relay')
      if (hasFlag('no-publish')) {
        const sign = ctx.getSigningFunction()
        const event = await sign({
          kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: tagValues,
          content,
        })
        console.log(JSON.stringify(event, null, 2))
        break
      }
      out(await handlePublishEvent(ctx, pool, {
        kind,
        content,
        tags: tagValues,
        relays: relayOverrides.length ? relayOverrides : undefined,
      }))
      break
    }

    case 'publish-raw': {
      const { readFileSync } = await import('node:fs')
      const raw = hasFlag('file')
        ? readFileSync(flag('file')!, 'utf-8')
        : readFileSync(0, 'utf-8')
      const inputEvent = JSON.parse(raw)
      const relayOverrides = flags('relay')
      const timeoutMs = flag('timeout') ? parseInt(flag('timeout')!, 10) : undefined
      const quorum = flag('quorum') ? parseInt(flag('quorum')!, 10) : undefined
      const report = hasFlag('report')

      const result = await handlePublishRaw(ctx, pool, {
        event: inputEvent,
        noSign: hasFlag('no-sign'),
        relays: relayOverrides.length ? relayOverrides : undefined,
        timeoutMs,
        quorum,
      })

      if (report) {
        const { accepted, rejected, errors } = result.publish
        const rows = [
          ...accepted.map(u => `  ✓  ${u}`),
          ...rejected.map(u => {
            const err = errors.find(e => e.startsWith(u))
            return `  ✗  ${u}${err ? `  (${err.slice(u.length + 2)})` : ''}`
          }),
        ]
        const status = result.publish.success ? 'OK' : 'FAILED'
        console.log(`publish-raw ${status}: ${accepted.length}/${accepted.length + rejected.length} relays accepted`)
        console.log(rows.join('\n'))
      } else {
        out(result)
      }
      break
    }

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
