import { handlePublishEvent } from '../../social/handlers.js'
import { handlePublishRaw } from '../../event/handlers.js'
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
      out(await handlePublishRaw(ctx, pool, {
        event: inputEvent,
        noSign: hasFlag('no-sign'),
        relays: relayOverrides.length ? relayOverrides : undefined,
      }))
      break
    }

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
