/**
 * In-memory Nostr relay for testing purposes.
 *
 * Implements NIP-01 (events, subscriptions, EOSE) and NIP-11 (relay info).
 * No persistence — events live in memory until the process exits.
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent, Filter } from 'nostr-tools'

export interface ServeOptions {
  hostname?: string
  port?: number
  eventsFile?: string
  quiet?: boolean
  /**
   * Require NIP-42 AUTH before serving EVENT or REQ.
   *
   * Exists so clients can be tested against an auth-gated relay without
   * needing a real one — bray's own NIP-42 support is otherwise only
   * exercisable against third-party infrastructure.
   */
  auth?: boolean
  /** Send the AUTH challenge on connect rather than waiting for a rejection. */
  eagerAuth?: boolean
  /**
   * Serve Blossom blob endpoints (BUD-01/02) alongside the relay.
   *
   * bray has ten blossom tools but no way to exercise them without a real
   * blossom server, the same gap `--auth` closed for NIP-42.
   */
  blossom?: boolean
}

interface Subscription {
  id: string
  filters: Filter[]
  ws: WebSocket
}

let subCounter = 0

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

/**
 * Check a NIP-42 auth event against the challenge this connection issued.
 *
 * Returns a reason string when it should be rejected, or undefined when it is
 * good. Beyond the signature this checks kind, freshness and that the
 * `challenge` tag matches — without the last one an auth event captured from
 * another connection would be replayable here.
 */
function checkAuthEvent(event: NostrEvent | undefined, challenge: string): string | undefined {
  if (!event?.id || !event?.sig || !event?.pubkey) return 'malformed auth event'
  if (event.kind !== 22242) return `expected kind 22242, got ${event.kind}`
  if (!verifyEvent(event)) return 'invalid signature'

  const sent = event.tags?.find(t => t[0] === 'challenge')?.[1]
  if (sent !== challenge) return 'challenge mismatch'

  // NIP-42 suggests rejecting anything far from the present
  const age = Math.abs(Math.floor(Date.now() / 1000) - event.created_at)
  if (age > 600) return 'auth event timestamp too far from now'

  return undefined
}

type BlobStore = Map<string, { data: Buffer; type: string; uploader: string; uploaded: number }>

const SHA256_PATH = /^\/([0-9a-f]{64})(\.[a-z0-9]+)?$/i
const LIST_PATH = /^\/list\/([0-9a-f]{64})$/i
/** 10 MiB, matching what the client refuses to send. */
const MAX_BLOB = 10 * 1024 * 1024

/** Does this URL belong to the Blossom surface rather than the relay? */
function isBlossomRequest(url: string): boolean {
  const path = url.split('?')[0]
  return path === '/upload' || SHA256_PATH.test(path) || LIST_PATH.test(path)
}

/**
 * Check a BUD-01 `Authorization: Nostr <base64 kind 24242>` header.
 *
 * Returns the uploader pubkey, or a reason to reject. The `t` and `x` tags are
 * both checked: without `x` an upload authorisation could be replayed to
 * delete a different blob, which is the whole point of binding it to a hash.
 */
function checkBlossomAuth(
  header: string | undefined,
  action: 'upload' | 'delete' | 'list',
  sha256: string | undefined,
): { pubkey: string } | { error: string } {
  if (!header?.startsWith('Nostr ')) return { error: 'missing Nostr authorization header' }

  let event: NostrEvent
  try {
    event = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'))
  } catch {
    return { error: 'authorization header is not base64-encoded JSON' }
  }

  if (event.kind !== 24242) return { error: `expected kind 24242, got ${event.kind}` }
  if (!verifyEvent(event)) return { error: 'invalid signature' }

  const t = event.tags?.find(tag => tag[0] === 't')?.[1]
  if (t !== action) return { error: `authorization is for "${t}", not "${action}"` }

  const expiration = event.tags?.find(tag => tag[0] === 'expiration')?.[1]
  if (expiration && Number(expiration) < Math.floor(Date.now() / 1000)) {
    return { error: 'authorization expired' }
  }

  if (sha256) {
    const x = event.tags?.filter(tag => tag[0] === 'x').map(tag => tag[1]) ?? []
    if (!x.includes(sha256)) return { error: 'authorization does not name this blob hash' }
  }

  return { pubkey: event.pubkey }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BLOB) {
        reject(new Error(`blob exceeds ${MAX_BLOB} bytes`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Serve BUD-01/02: PUT /upload, GET|HEAD /<sha256>, GET /list/<pubkey>, DELETE /<sha256>. */
async function serveBlossom(
  req: IncomingMessage,
  res: ServerResponse,
  blobs: BlobStore,
  hostname: string,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]
  const port = (req.socket.localPort ?? 0)
  const base = `http://${hostname}:${port}`
  const json = (code: number, body: unknown): void => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  try {
    if (path === '/upload' && req.method === 'PUT') {
      const body = await readBody(req)
      const sha256 = createHash('sha256').update(body).digest('hex')
      const auth = checkBlossomAuth(req.headers.authorization, 'upload', sha256)
      if ('error' in auth) return json(401, { message: auth.error })

      const type = req.headers['content-type'] ?? 'application/octet-stream'
      const uploaded = Math.floor(Date.now() / 1000)
      blobs.set(sha256, { data: body, type: String(type), uploader: auth.pubkey, uploaded })
      log(`blossom: stored ${sha256.slice(0, 12)}… (${body.length} bytes)`)
      return json(200, { url: `${base}/${sha256}`, sha256, size: body.length, type, uploaded })
    }

    const listMatch = LIST_PATH.exec(path)
    if (listMatch && req.method === 'GET') {
      const pubkey = listMatch[1].toLowerCase()
      const owned = [...blobs.entries()]
        .filter(([, b]) => b.uploader === pubkey)
        .map(([sha256, b]) => ({ url: `${base}/${sha256}`, sha256, size: b.data.length, type: b.type, uploaded: b.uploaded }))
      return json(200, owned)
    }

    const blobMatch = SHA256_PATH.exec(path)
    if (blobMatch) {
      const sha256 = blobMatch[1].toLowerCase()
      const blob = blobs.get(sha256)

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!blob) return json(404, { message: 'blob not found' })
        res.writeHead(200, { 'Content-Type': blob.type, 'Content-Length': String(blob.data.length) })
        res.end(req.method === 'HEAD' ? undefined : blob.data)
        return
      }

      if (req.method === 'DELETE') {
        const auth = checkBlossomAuth(req.headers.authorization, 'delete', sha256)
        if ('error' in auth) return json(401, { message: auth.error })
        if (!blob) return json(404, { message: 'blob not found' })
        // Only the uploader may delete, otherwise anyone could clear the store
        if (blob.uploader !== auth.pubkey) return json(403, { message: 'not the uploader of this blob' })
        blobs.delete(sha256)
        log(`blossom: deleted ${sha256.slice(0, 12)}…`)
        return json(200, { message: 'deleted' })
      }
    }

    json(405, { message: `method ${req.method} not allowed on ${path}` })
  } catch (e) {
    json(400, { message: (e as Error).message })
  }
}

export function startRelay(opts: ServeOptions = {}): { url: string; port: number; ready: Promise<void>; close: () => void } {
  const hostname = opts.hostname ?? 'localhost'
  const port = opts.port ?? 10547
  const quiet = opts.quiet ?? false
  const requireAuth = opts.auth ?? false
  const eagerAuth = opts.eagerAuth ?? false
  const enableBlossom = opts.blossom ?? false
  /** sha256 -> blob. In memory, like the event store. */
  const blobs = new Map<string, { data: Buffer; type: string; uploader: string; uploaded: number }>()
  const log = quiet ? () => {} : (...args: unknown[]) => console.error('[relay]', ...args)

  // The bundled test relay has no auth and accepts arbitrary signed events.
  // Binding it to anything other than loopback exposes a writable Nostr endpoint
  // to the local network — almost never the intent. Warn loudly even in quiet
  // mode, since this is a security-relevant choice.
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!isLoopback) {
    console.warn(
      `[relay] WARNING: bray test relay bound to ${hostname}:${port} (non-loopback). ` +
      `It has no auth and accepts arbitrary signed events. Use only on trusted networks.`,
    )
  }

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
    if (enableBlossom && isBlossomRequest(req.url ?? '/')) {
      void serveBlossom(req, res, blobs, hostname, log)
      return
    }

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
    // NIP-42: one challenge per connection; authedPubkey is set once the
    // client returns a valid kind 22242 naming this relay and that challenge.
    const challenge = randomBytes(16).toString('hex')
    let authedPubkey: string | undefined
    log('Client connected')

    if (requireAuth && eagerAuth) {
      ws.send(JSON.stringify(['AUTH', challenge]))
    }

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

      if (type === 'AUTH') {
        const authEvent = msg[1] as NostrEvent
        const problem = checkAuthEvent(authEvent, challenge)
        if (problem) {
          ws.send(JSON.stringify(['OK', authEvent?.id ?? '', false, `auth-required: ${problem}`]))
          return
        }
        authedPubkey = authEvent.pubkey
        log('Client authenticated as', authedPubkey)
        ws.send(JSON.stringify(['OK', authEvent.id, true, '']))
        return
      }

      if (requireAuth && !authedPubkey && (type === 'EVENT' || type === 'REQ')) {
        // Send the challenge alongside the rejection so a client that did not
        // ask for one up front can still recover without reconnecting.
        ws.send(JSON.stringify(['AUTH', challenge]))
        if (type === 'EVENT') {
          const e = msg[1] as NostrEvent
          ws.send(JSON.stringify(['OK', e?.id ?? '', false, 'auth-required: authentication required']))
        } else {
          ws.send(JSON.stringify(['CLOSED', String(msg[1]), 'auth-required: authentication required']))
        }
        return
      }

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
        const key = `${subId}-${++subCounter}`
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

  // Resolves once the socket is actually bound. Callers that connect straight
  // after startRelay() returns would otherwise race the listen callback — and
  // with port 0 the assigned port is not even known until it fires.
  const ready = new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, hostname, () => {
      log(`Listening on ${urlFor(boundPort())}`)
      resolve()
    })
  })

  // With port 0 the OS assigns a free port, so the requested port is not the
  // one we ended up on. Callers (and tests, which use 0 to avoid colliding
  // with a parallel run) need the real one.
  const boundPort = (): number => {
    const addr = httpServer.address()
    return typeof addr === 'object' && addr ? addr.port : port
  }
  const urlFor = (p: number): string => `ws://${hostname}:${p}`

  return {
    get url() { return urlFor(boundPort()) },
    get port() { return boundPort() },
    ready,
    close: () => {
      wss.close()
      httpServer.close()
    },
  }
}
