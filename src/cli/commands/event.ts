import { assertEventSemanticallyValid, handlePublishEvent, handlePublishRaw, resolveKind } from '../../exports.js'
import { nip19 } from 'nostr-tools'
import type { EventValidationMode } from '../../event-validation/validator.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { flag, flags, hasFlag, flagAny, flagsAny, out } = h

  switch (cmd) {
    case 'event': {
      const kindArg = flagAny('kind', 'k')
      if (!kindArg) {
        throw new Error('Usage: event -k <number|name> [-c content] [-t k=v] [-p pubkey] [-e id] [-d ident] [--relay url]')
      }
      // Accepts a number or a registry kind name, e.g. -k "short text note"
      const kind = resolveKind(kindArg)

      const tagValues = collectTags(flagsAny('tag', 't'), {
        p: flagsAny('p'), e: flagsAny('e'), d: flagsAny('d'), h: flagsAny('h'),
      })
      const content = flagAny('content', 'c') ?? ''
      const validationMode = parseValidationMode(flag('validation'))
      const relayOverrides = flagsAny('relay', 'r')
      const pow = flag('pow') ? parseInt(flag('pow')!, 10) : undefined
      const powTimeoutMs = flag('pow-timeout') ? parseInt(flag('pow-timeout')!, 10) : undefined
      const createdAtArg = flagAny('created-at', 'ts', 'time')
      const createdAt = createdAtArg ? parseTimestamp(createdAtArg) : Math.floor(Date.now() / 1000)

      if (hasFlag('no-publish')) {
        const { minePow } = await import('../../event/pow.js')
        let template = { kind, created_at: createdAt, tags: tagValues, content }
        if (pow !== undefined) {
          template = minePow(template, { difficulty: pow, pubkey: ctx.activePublicKeyHex, timeoutMs: powTimeoutMs }).template
        }
        const validation = assertEventSemanticallyValid(template, validationMode)
        reportWarnings(validation.issues)
        const sign = ctx.getSigningFunction()
        const event = await sign(template)
        // --envelope emits the relay wire form, ready to paste into a socket
        console.log(hasFlag('envelope')
          ? JSON.stringify(['EVENT', event])
          : JSON.stringify(event, null, 2))
        if (hasFlag('nevent')) printNevent(event, relayOverrides)
        break
      }

      const result = await handlePublishEvent(ctx, pool, {
        kind,
        content,
        tags: tagValues,
        createdAt,
        relays: relayOverrides.length ? relayOverrides : undefined,
        validationMode,
        pow,
        powTimeoutMs,
      })
      out(result)
      if (hasFlag('nevent')) printNevent(result.event, relayOverrides)
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
      const validationMode = parseValidationMode(flag('validation'))

      const result = await handlePublishRaw(ctx, pool, {
        event: inputEvent,
        noSign: hasFlag('no-sign'),
        relays: relayOverrides.length ? relayOverrides : undefined,
        timeoutMs,
        quorum,
        validationMode,
        pow: flag('pow') ? parseInt(flag('pow')!, 10) : undefined,
        powTimeoutMs: flag('pow-timeout') ? parseInt(flag('pow-timeout')!, 10) : undefined,
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

function parseValidationMode(value: string | undefined): EventValidationMode {
  const mode = value ?? 'strict-known'
  if (mode !== 'strict-known' && mode !== 'off') {
    throw new Error('Validation mode must be strict-known or off')
  }
  return mode
}

function reportWarnings(issues: Array<{ severity: string; code: string; message: string }>): void {
  for (const entry of issues) {
    if (entry.severity === 'warning') console.error(`validation warning [${entry.code}]: ${entry.message}`)
  }
}

/**
 * Merge `--tag k=v` entries with the single-letter shortcuts.
 *
 * Shortcuts come after the explicit tags so that `-t p=<x> -p <y>` yields both,
 * in the order written, rather than one silently replacing the other.
 */
function collectTags(tagArgs: string[], shortcuts: Record<string, string[]>): string[][] {
  const tags = tagArgs.map(t => {
    const eq = t.indexOf('=')
    if (eq === -1) return [t]
    // A value may itself contain '=', so only split on the first one
    return [t.slice(0, eq), t.slice(eq + 1)]
  })
  for (const [name, values] of Object.entries(shortcuts)) {
    for (const v of values) tags.push([name, v])
  }
  return tags
}

/** Parse a created_at: a unix timestamp, an ISO date, or `now`. */
function parseTimestamp(value: string): number {
  if (value === 'now') return Math.floor(Date.now() / 1000)
  if (/^\d+$/.test(value)) return Number(value)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Could not read "${value}" as a timestamp. Use a unix time, an ISO date, or "now".`)
  }
  return Math.floor(parsed / 1000)
}

/** Print the nevent code to stderr, so stdout stays parseable. */
function printNevent(event: { id: string; pubkey: string; kind: number }, relays: string[]): void {
  const code = nip19.neventEncode({
    id: event.id,
    author: event.pubkey,
    kind: event.kind,
    ...(relays.length ? { relays } : {}),
  })
  console.error(code)
}
