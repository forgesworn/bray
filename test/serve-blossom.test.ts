import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { startRelay } from '../src/serve.js'

/**
 * Exercises the server side of BUD-01/02.
 *
 * These go over raw fetch rather than through bray's blossom client, because
 * that client calls validatePublicUrl and so refuses loopback — an SSRF guard
 * worth keeping intact. The auth headers below are built exactly as the client
 * builds them, so this still proves the two ends agree.
 */

let relay: ReturnType<typeof startRelay>
let base: string

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const otherSk = generateSecretKey()

/** The same `Authorization: Nostr <base64 kind 24242>` header the client sends. */
function authHeader(
  action: 'upload' | 'delete',
  sha256: string,
  opts: { sk?: Uint8Array; expiration?: number; kind?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000)
  const event = finalizeEvent({
    kind: opts.kind ?? 24242,
    created_at: now,
    tags: [
      ['t', action],
      ['x', sha256],
      ['expiration', String(opts.expiration ?? now + 300)],
    ],
    content: '',
  }, opts.sk ?? sk)
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

const BODY = Buffer.from('hello blossom')
const HASH = createHash('sha256').update(BODY).digest('hex')

async function upload(body = BODY, header?: string) {
  return fetch(`${base}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: header ?? authHeader('upload', createHash('sha256').update(body).digest('hex')),
      'Content-Type': 'text/plain',
    },
    body,
  })
}

describe('serve --blossom', () => {
  beforeAll(async () => {
    relay = startRelay({ port: 0, quiet: true, blossom: true })
    await relay.ready
    base = relay.url.replace('ws://', 'http://')
  })
  afterAll(() => relay?.close())

  it('accepts an upload and returns a blob descriptor', async () => {
    const res = await upload()
    expect(res.status).toBe(200)
    const d = await res.json() as any
    expect(d.sha256).toBe(HASH)
    expect(d.size).toBe(BODY.length)
    expect(d.type).toBe('text/plain')
    expect(d.url).toContain(HASH)
  })

  it('serves the blob back byte for byte', async () => {
    await upload()
    const res = await fetch(`${base}/${HASH}`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY)
  })

  it('answers HEAD without a body', async () => {
    await upload()
    const res = await fetch(`${base}/${HASH}`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(BODY.length))
  })

  it('404s an unknown hash', async () => {
    const res = await fetch(`${base}/${'f'.repeat(64)}`)
    expect(res.status).toBe(404)
  })

  it('lists the blobs a pubkey uploaded', async () => {
    await upload()
    const res = await fetch(`${base}/list/${pk}`)
    expect(res.status).toBe(200)
    const list = await res.json() as any[]
    expect(list.some(b => b.sha256 === HASH)).toBe(true)
  })

  it('does not list another pubkey as the uploader', async () => {
    await upload()
    const res = await fetch(`${base}/list/${getPublicKey(otherSk)}`)
    expect(await res.json()).toEqual([])
  })

  it('tolerates a file extension on the path', async () => {
    await upload()
    const res = await fetch(`${base}/${HASH}.txt`)
    expect(res.status).toBe(200)
  })

  it('deletes a blob for its uploader', async () => {
    await upload()
    const res = await fetch(`${base}/${HASH}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader('delete', HASH) },
    })
    expect(res.status).toBe(200)
    expect((await fetch(`${base}/${HASH}`)).status).toBe(404)
  })
})

describe('serve --blossom authorisation', () => {
  beforeAll(async () => {
    relay = startRelay({ port: 0, quiet: true, blossom: true })
    await relay.ready
    base = relay.url.replace('ws://', 'http://')
  })
  afterAll(() => relay?.close())

  it('refuses an upload with no authorization header', async () => {
    const res = await fetch(`${base}/upload`, { method: 'PUT', body: BODY })
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/missing Nostr authorization/)
  })

  it('refuses an authorization naming a different blob', async () => {
    // Binding the authorisation to a hash is what stops one upload grant being
    // replayed against another blob.
    const res = await upload(BODY, authHeader('upload', 'a'.repeat(64)))
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/does not name this blob hash/)
  })

  it('refuses an authorization for the wrong action', async () => {
    const res = await upload(BODY, authHeader('delete', HASH))
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/is for "delete", not "upload"/)
  })

  it('refuses an expired authorization', async () => {
    const res = await upload(BODY, authHeader('upload', HASH, { expiration: Math.floor(Date.now() / 1000) - 10 }))
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/expired/)
  })

  it('refuses the wrong event kind', async () => {
    const res = await upload(BODY, authHeader('upload', HASH, { kind: 1 }))
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/expected kind 24242/)
  })

  it('refuses a tampered authorization', async () => {
    const good = authHeader('upload', HASH)
    const decoded = JSON.parse(Buffer.from(good.slice(6), 'base64').toString())
    decoded.content = 'tampered'
    const bad = `Nostr ${Buffer.from(JSON.stringify(decoded)).toString('base64')}`
    const res = await upload(BODY, bad)
    expect(res.status).toBe(401)
    expect((await res.json() as any).message).toMatch(/invalid signature/)
  })

  it('will not let a different pubkey delete someone else\'s blob', async () => {
    await upload()
    const res = await fetch(`${base}/${HASH}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader('delete', HASH, { sk: otherSk }) },
    })
    expect(res.status).toBe(403)
    // ...and the blob survives
    expect((await fetch(`${base}/${HASH}`)).status).toBe(200)
  })
})

describe('serve without --blossom', () => {
  let plain: ReturnType<typeof startRelay>

  beforeAll(async () => {
    plain = startRelay({ port: 0, quiet: true })
    await plain.ready
  })
  afterAll(() => plain?.close())

  it('does not expose blob endpoints', async () => {
    const res = await fetch(`${plain.url.replace('ws://', 'http://')}/${HASH}`)
    // Falls through to the relay's plain-text root rather than serving a blob
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
  })
})
