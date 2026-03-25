/**
 * In-memory Nostr relay for testing purposes.
 *
 * Implements NIP-01 (events, subscriptions, EOSE) and NIP-11 (relay info).
 * No persistence — events live in memory until the process exits.
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent, Filter } from 'nostr-tools'

export interface ServeOptions {
  hostname?: string
  port?: number
  eventsFile?: string
  quiet?: boolean
}

interface Subscription {
  id: string
  filters: Filter[]
  ws: WebSocket
}

/** Check if an event matches a single filter */
function matchFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  if (filter.since && event.created_at < filter.since) return false
  if (filter.until && event.created_at > filter.until) return false

  // Tag filters (#e, #p, #t, #d, etc.)
  for (const key of Object.keys(filter)) {
    if (key.startsWith('#')) {
      const vals = (filter as Record<string, unknown>)[key] as string[] | undefined
      if (!vals || !Array.isArray(vals)) continue
      const tagName = key.slice(1)
      const eventTagValues = event.tags.filter(t => t[0] === tagName).map(t => t[1])
      if (!vals.some(v => eventTagValues.includes(v))) return false
    }
  }

  return true
}

/** Check if an event matches any filter in a list */
function matchFilters(filters: Filter[], event: NostrEvent): boolean {
  return filters.some(f => matchFilter(f, event))
}

export function startRelay(opts: ServeOptions = {}): { url: string; close: () => void } {
  const hostname = opts.hostname ?? 'localhost'
  const port = opts.port ?? 10547
  const quiet = opts.quiet ?? false
  const log = quiet ? () => {} : (...args: unknown[]) => console.error('[relay]', ...args)

  const events = new Map<string, NostrEvent>()
  const subscriptions = new Map<string, Subscription>()

  // Pre-load events from JSONL file
  if (opts.eventsFile) {
    const lines = readFileSync(opts.eventsFile, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as NostrEvent
        events.set(event.id, event)
      } catch { /* skip malformed lines */ }
    }
    log(`Loaded ${events.size} events from ${opts.eventsFile}`)
  }

  const httpServer = createServer((req, res) => {
    // NIP-11 relay info document
    if (req.headers.accept?.includes('application/nostr+json')) {
      res.writeHead(200, { 'Content-Type': 'application/nostr+json' })
      res.end(JSON.stringify({
        name: 'nostr-bray test relay',
        description: 'In-memory relay for testing',
        supported_nips: [1, 11],
        software: 'nostr-bray',
        version: '0.1.0',
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('nostr-bray test relay — connect via WebSocket')
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws) => {
    const clientSubs = new Set<string>()
    log('Client connected')

    ws.on('message', (raw) => {
      let msg: unknown[]
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        ws.send(JSON.stringify(['NOTICE', 'Invalid JSON']))
        return
      }

      if (!Array.isArray(msg) || msg.length < 2) {
        ws.send(JSON.stringify(['NOTICE', 'Invalid message format']))
        return
      }

      const type = msg[0]

      if (type === 'EVENT') {
        const event = msg[1] as NostrEvent
        if (!event?.id || !event?.sig || !event?.pubkey) {
          ws.send(JSON.stringify(['OK', event?.id ?? '', false, 'invalid: missing fields']))
          return
        }

        if (!verifyEvent(event)) {
          ws.send(JSON.stringify(['OK', event.id, false, 'invalid: signature verification failed']))
          return
        }

        // Store event
        events.set(event.id, event)
        ws.send(JSON.stringify(['OK', event.id, true, '']))
        log(`Stored event ${event.id.slice(0, 8)}... kind:${event.kind}`)

        // Notify matching subscriptions
        for (const sub of subscriptions.values()) {
          if (matchFilters(sub.filters, event) && sub.ws.readyState === WebSocket.OPEN) {
            sub.ws.send(JSON.stringify(['EVENT', sub.id, event]))
          }
        }
      } else if (type === 'REQ') {
        const subId = msg[1] as string
        const filters = msg.slice(2) as Filter[]

        // Register subscription
        const sub: Subscription = { id: subId, filters, ws }
        const key = `${subId}-${Date.now()}`
        subscriptions.set(key, sub)
        clientSubs.add(key)

        // Send matching stored events
        let count = 0
        const limit = filters.reduce((min, f) => Math.min(min, f.limit ?? Infinity), Infinity)
        const matching = [...events.values()]
          .filter(e => matchFilters(filters, e))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit === Infinity ? undefined : limit)

        for (const event of matching) {
          ws.send(JSON.stringify(['EVENT', subId, event]))
          count++
        }

        // EOSE
        ws.send(JSON.stringify(['EOSE', subId]))
        log(`REQ ${subId}: ${count} events, ${filters.length} filter(s)`)
      } else if (type === 'CLOSE') {
        const subId = msg[1] as string
        for (const key of clientSubs) {
          if (subscriptions.get(key)?.id === subId) {
            subscriptions.delete(key)
            clientSubs.delete(key)
          }
        }
        ws.send(JSON.stringify(['CLOSED', subId, '']))
      } else if (type === 'COUNT') {
        const subId = msg[1] as string
        const filters = msg.slice(2) as Filter[]
        const count = [...events.values()].filter(e => matchFilters(filters, e)).length
        ws.send(JSON.stringify(['COUNT', subId, { count }]))
      } else {
        ws.send(JSON.stringify(['NOTICE', `Unknown message type: ${type}`]))
      }
    })

    ws.on('close', () => {
      for (const key of clientSubs) {
        subscriptions.delete(key)
      }
      log('Client disconnected')
    })
  })

  httpServer.listen(port, hostname, () => {
    log(`Listening on ws://${hostname}:${port}`)
  })

  return {
    url: `ws://${hostname}:${port}`,
    close: () => {
      wss.close()
      httpServer.close()
    },
  }
}
