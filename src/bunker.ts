/**
 * NIP-46 Bunker — remote signing daemon.
 *
 * Holds the user's secret key and responds to signing requests from
 * authorised clients over Nostr relays. Clients never see the nsec.
 *
 * Protocol: NIP-46 (Nostr Connect)
 * - Client sends kind 24133 encrypted request
 * - Bunker responds with kind 24133 encrypted response
 * - All communication NIP-44 encrypted between client and bunker
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { SimplePool } from 'nostr-tools/pool'
import { webSocketFor } from './ws-safe.js'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { IdentityContext } from './context.js'
import { readStateFile, writeStateFile } from './state.js'


export interface BunkerOptions {
  ctx: IdentityContext
  relays: string[]
  authorizedKeys?: string[]  // hex pubkeys allowed to send requests
  bunkerKeyHex?: string      // persistent bunker keypair (hex) — if not provided, generates ephemeral
  quiet?: boolean
  heartwoodExtensions?: boolean
  stateDir?: string          // override state directory (for tests)
  torProxy?: string          // TOR_PROXY: route relay traffic through this SOCKS proxy
  /**
   * Approve any client that sends `connect`, with no secret: the behaviour
   * before connect secrets. Ignored when `authorizedKeys` is set.
   */
  open?: boolean
  /** Called with the new link each time a client uses up the connect secret. */
  onUrlChange?: (url: string) => void
}

/**
 * Remove a client pubkey from every bunker key's approvals in
 * approved-clients.json. A running daemon notices on the client's next
 * request. Returns how many bunker keys had approved it.
 */
export function revokeClient(clientPk: string, stateDir?: string): number {
  const file = readStateFile<Record<string, unknown>>('approved-clients.json', stateDir)
  let removed = 0
  for (const [bunker, list] of Object.entries(file)) {
    if (!Array.isArray(list) || !list.includes(clientPk)) continue
    file[bunker] = list.filter(pk => pk !== clientPk)
    removed++
  }
  if (removed > 0) writeStateFile('approved-clients.json', file, stateDir)
  return removed
}

export interface BunkerInstance {
  /** bunker:// URI for clients. Carries the current connect secret, so it changes once used. */
  readonly url: string
  /** Client pubkeys approved for this bunker key (approved-clients.json), less any revoked since start. */
  approvedClients: readonly string[]
  /** Whether a new client needs the connect secret (false with authorizedKeys or open). */
  requiresSecret: boolean
  pubkey: string     // bunker's pubkey (hex)
  npub: string       // bunker's npub
  close: () => void
}

export function startBunker(opts: BunkerOptions): BunkerInstance {
  const { ctx, relays, quiet } = opts
  const log = quiet ? () => {} : (...args: unknown[]) => console.error('[bunker]', ...args)

  // Bunker keypair — must be computed first so we can load persisted approvals
  const bunkerSk = opts.bunkerKeyHex
    ? Buffer.from(opts.bunkerKeyHex, 'hex')
    : generateSecretKey()
  const bunkerPk = getPublicKey(bunkerSk)
  const bunkerNpub = npubEncode(bunkerPk)

  // Authorised clients: CLI flag controls the gate, persisted approvals supplement
  const APPROVALS_FILE = 'approved-clients.json'
  const persisted = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
  const bunkerApprovals = persisted[bunkerPk] ?? []
  const cliAuthorizedKeys = new Set(opts.authorizedKeys ?? [])
  const authorizedKeys = new Set([
    ...cliAuthorizedKeys,
    ...bunkerApprovals,
  ])

  // Who may become a client. With --authorized-keys, only those keys (as
  // before). Otherwise a new client needs the connect secret from the link,
  // unless the daemon runs open. Clients approved earlier never need it.
  const allowList = cliAuthorizedKeys.size > 0
  const requireSecret = !allowList && opts.open !== true
  // The unused secret is kept per bunker key, so a link handed out before a
  // restart still works. Only for a persistent bunker key: an ephemeral one
  // gets a new link every run anyway.
  const SECRETS_FILE = 'bunker-secrets.json'
  const persistSecret = requireSecret && opts.bunkerKeyHex !== undefined
  const newSecret = (): string => {
    const secret = randomBytes(16).toString('hex')
    if (persistSecret) {
      const current = readStateFile<Record<string, string>>(SECRETS_FILE, opts.stateDir)
      current[bunkerPk] = secret
      writeStateFile(SECRETS_FILE, current, opts.stateDir)
    }
    return secret
  }
  const savedSecret = persistSecret
    ? readStateFile<Record<string, string>>(SECRETS_FILE, opts.stateDir)[bunkerPk]
    : undefined
  let connectSecret = requireSecret
    ? (typeof savedSecret === 'string' && /^[0-9a-f]{32}$/.test(savedSecret) ? savedSecret : newSecret())
    : undefined

  function secretMatches(given: unknown): boolean {
    if (connectSecret === undefined || typeof given !== 'string') return false
    const a = Buffer.from(given)
    const b = Buffer.from(connectSecret)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  function approve(clientPk: string): void {
    authorizedKeys.add(clientPk)
    if (bunkerApprovals.includes(clientPk)) return
    bunkerApprovals.push(clientPk)
    // Add just this key to the file, so a key added meanwhile by `bunker
    // authorize` stays and a key removed by `bunker revoke` stays removed.
    const current = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
    const onDisk = Array.isArray(current[bunkerPk]) ? current[bunkerPk] : []
    current[bunkerPk] = [...new Set([...onDisk, clientPk])]
    writeStateFile(APPROVALS_FILE, current, opts.stateDir)
    log(`Approved and persisted client: ${clientPk.slice(0, 12)}...`)
  }

  // Sign in (NIP-42) with the bunker key when a relay asks, so a private
  // relay lets the bunker read requests addressed to it.
  const pool = new SimplePool({ websocketImplementation: webSocketFor(opts.torProxy) } as ConstructorParameters<typeof SimplePool>[0])
  pool.automaticallyAuth = () => async (template: EventTemplate) => finalizeEvent(template, bunkerSk)

  // Subscribe to kind 24133 events addressed to us
  const sub = pool.subscribeMany(
    relays,
    { kinds: [24133], '#p': [bunkerPk] } as any,
    {
      onevent: async (event: NostrEvent) => {
        try {
          await handleRequest(event)
        } catch (e: any) {
          log(`Error handling request: ${e.message}`)
        }
      },
    },
  )

  // `bunker revoke` edits the approvals file while the daemon runs, so a
  // client approved in memory is checked against the file before each request.
  function stillApproved(clientPk: string): boolean {
    if (cliAuthorizedKeys.has(clientPk)) return true
    const current = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
    const onDisk = Array.isArray(current[bunkerPk]) ? current[bunkerPk] : []
    if (onDisk.includes(clientPk)) return true
    authorizedKeys.delete(clientPk)
    const i = bunkerApprovals.indexOf(clientPk)
    if (i >= 0) bunkerApprovals.splice(i, 1)
    log(`Client approval revoked: ${clientPk.slice(0, 12)}...`)
    return false
  }

  async function handleRequest(event: NostrEvent): Promise<void> {
    const clientPk = event.pubkey
    if (authorizedKeys.has(clientPk)) stillApproved(clientPk)

    // With --authorized-keys, drop anyone else unanswered, as before.
    if (allowList && !authorizedKeys.has(clientPk)) {
      log(`Rejected request from unauthorized key: ${clientPk.slice(0, 12)}...`)
      return
    }

    // Decrypt the request
    const conversationKey = getConversationKey(bunkerSk, clientPk)
    let request: { id: string; method: string; params: string[] }
    try {
      const plaintext = decrypt(event.content, conversationKey)
      request = JSON.parse(plaintext)
    } catch {
      log('Failed to decrypt request')
      return
    }

    log(`Request ${request.id}: ${request.method}`)

    // A client not yet approved gets in only with the connect secret, which
    // then works once: the daemon moves to a new one and reports the new link.
    // Check, rotate and approve must stay free of `await`: two clients racing
    // with the same secret then cannot both get in.
    if (requireSecret && !authorizedKeys.has(clientPk)) {
      if (request.method !== 'connect') {
        log(`Ignored ${request.method} from unapproved client: ${clientPk.slice(0, 12)}...`)
        return
      }
      if (!secretMatches(request.params?.[1])) {
        log(`Refused connect without the current secret: ${clientPk.slice(0, 12)}...`)
        await respond(clientPk, conversationKey, request.id, '', 'connect refused: use the current bunker:// link from the daemon, which carries a one-time secret')
        return
      }
      connectSecret = newSecret()
      approve(clientPk)
      log('Connect secret used; moved to a new one')
      opts.onUrlChange?.(buildUrl())
    }

    let result: string
    let error: string | undefined

    switch (request.method) {
      case 'connect':
        approve(clientPk)
        result = 'ack'
        break

      case 'ping':
        result = 'pong'
        break

      case 'get_public_key':
        result = ctx.activePublicKeyHex
        break

      // `sign_event_compact` is the Heartwood dialect, and Bray speaks it so a
      // client does not have to keep two code paths or waste a round trip
      // discovering it is unsupported.
      //
      // Two differences from NIP-46, both about not moving the event around as
      // a string. params[0] may be the event OBJECT rather than a stringified
      // event, which spares a signer an unescape pass costing twice the content
      // in one allocation; and the compact reply returns only what the client
      // cannot work out itself. On a hardware signer those two copies are the
      // difference between a 12 KB and an 18 KB ceiling. Bray has no such
      // limit, but matching the dialect keeps clients simple.
      case 'sign_event':
      case 'sign_event_compact': {
        // Declared string[], but that was always a claim about the client
        // rather than a guarantee, and here it is genuinely either.
        const raw: unknown = request.params[0]
        const template = (typeof raw === 'string' ? JSON.parse(raw) : raw) as EventTemplate
        const sign = ctx.getSigningFunction()
        const signed = await sign(template)
        result = request.method === 'sign_event_compact'
          ? JSON.stringify({
              id: signed.id,
              pubkey: signed.pubkey,
              created_at: signed.created_at,
              sig: signed.sig,
            })
          : JSON.stringify(signed)
        break
      }

      case 'nip04_encrypt': {
        const [thirdPartyPk, plaintext] = request.params
        const { encrypt: nip04encrypt } = await import('nostr-tools/nip04')
        result = nip04encrypt(ctx.activePrivateKey, thirdPartyPk, plaintext)
        break
      }

      case 'nip04_decrypt': {
        const [thirdPartyPk, ciphertext] = request.params
        const { decrypt: nip04decrypt } = await import('nostr-tools/nip04')
        result = nip04decrypt(ctx.activePrivateKey, thirdPartyPk, ciphertext)
        break
      }

      case 'nip44_encrypt': {
        const [thirdPartyPk, plaintext] = request.params
        const ck = getConversationKey(ctx.activePrivateKey, thirdPartyPk)
        result = encrypt(plaintext, ck)
        break
      }

      case 'nip44_decrypt': {
        const [thirdPartyPk, ciphertext] = request.params
        const ck = getConversationKey(ctx.activePrivateKey, thirdPartyPk)
        result = decrypt(ciphertext, ck)
        break
      }

      case 'heartwood_list_identities': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const list = await ctx.listIdentities()
        result = JSON.stringify(list)
        break
      }

      case 'heartwood_derive': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const [purpose, indexStr] = request.params
        const identity = await ctx.derive(purpose, parseInt(indexStr, 10))
        result = JSON.stringify(identity)
        break
      }

      case 'heartwood_derive_persona': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const [name, indexStr] = request.params
        const identity = await ctx.derivePersona(name, parseInt(indexStr, 10))
        result = JSON.stringify(identity)
        break
      }

      case 'heartwood_switch': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const [target, idxStr] = request.params
        await ctx.switch(target, idxStr ? parseInt(idxStr, 10) : undefined)
        result = JSON.stringify({ npub: ctx.activeNpub })
        break
      }

      case 'heartwood_create_proof': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const [, mode] = request.params
        const proof = await ctx.prove((mode as 'blind' | 'full') ?? 'blind')
        result = JSON.stringify(proof)
        break
      }

      case 'heartwood_recover': {
        if (!opts.heartwoodExtensions) { result = ''; error = `unsupported method: ${request.method}`; break }
        const [lookaheadStr] = request.params
        const recovered = await ctx.recover(lookaheadStr ? parseInt(lookaheadStr, 10) : undefined)
        result = JSON.stringify(recovered)
        break
      }

      default:
        result = ''
        error = `unsupported method: ${request.method}`
    }

    await respond(clientPk, conversationKey, request.id, result, error)
  }

  async function respond(clientPk: string, conversationKey: Uint8Array, id: string, result: string, error?: string): Promise<void> {
    const response = error
      ? JSON.stringify({ id, result: '', error })
      : JSON.stringify({ id, result })

    const encrypted = encrypt(response, conversationKey)
    const responseEvent = finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', clientPk]],
      content: encrypted,
    }, bunkerSk) as unknown as NostrEvent

    await Promise.any(pool.publish(relays, responseEvent))
    log(`Response ${id}: ${error ?? 'ok'}`)
  }

  // Build bunker:// URI
  const relayParams = relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')
  const buildUrl = () => connectSecret === undefined
    ? `bunker://${bunkerPk}?${relayParams}`
    : `bunker://${bunkerPk}?${relayParams}&secret=${connectSecret}`

  log(`Bunker started: ${bunkerNpub}`)
  // The secret stays out of the log; the caller shows the link (bunker.url).
  log(`URI: bunker://${bunkerPk}?${relayParams}${connectSecret === undefined ? '' : ' (plus a connect secret)'}`)
  log(`Signing as: ${ctx.activeNpub}`)
  if (allowList) {
    log(`Authorized keys: ${authorizedKeys.size} (${cliAuthorizedKeys.size} CLI + ${bunkerApprovals.length} persisted)`)
  } else if (requireSecret) {
    log(`New clients need the secret in this link; it works once. ${bunkerApprovals.length} client(s) approved earlier.`)
  } else {
    log('WARNING: running open (--open): any client that connects is approved')
  }

  return {
    get url() { return buildUrl() },
    get approvedClients() { return [...bunkerApprovals] },
    requiresSecret: requireSecret,
    pubkey: bunkerPk,
    npub: bunkerNpub,
    close: () => {
      sub.close()
      pool.destroy()
      bunkerSk.fill(0)
    },
  }
}
