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

import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool'
import WebSocket from 'ws'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import type { IdentityContext } from './context.js'
import { readStateFile, writeStateFile } from './state.js'

useWebSocketImplementation(WebSocket)

export interface BunkerOptions {
  ctx: IdentityContext
  relays: string[]
  authorizedKeys?: string[]  // hex pubkeys allowed to send requests
  bunkerKeyHex?: string      // persistent bunker keypair (hex) — if not provided, generates ephemeral
  quiet?: boolean
  heartwoodExtensions?: boolean
  stateDir?: string          // override state directory (for tests)
}

export interface BunkerInstance {
  url: string        // bunker:// URI for clients
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

  const pool = new SimplePool()

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

  async function handleRequest(event: NostrEvent): Promise<void> {
    const clientPk = event.pubkey

    // Check authorization — gate only activates when CLI --authorized-keys were set
    if (cliAuthorizedKeys.size > 0 && !authorizedKeys.has(clientPk)) {
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

    let result: string
    let error: string | undefined

    switch (request.method) {
      case 'connect':
        // Persist newly-approved client
        if (!bunkerApprovals.includes(clientPk)) {
          bunkerApprovals.push(clientPk)
          authorizedKeys.add(clientPk)
          const current = readStateFile<Record<string, string[]>>(APPROVALS_FILE, opts.stateDir)
          current[bunkerPk] = bunkerApprovals
          writeStateFile(APPROVALS_FILE, current, opts.stateDir)
          log(`Approved and persisted client: ${clientPk.slice(0, 12)}...`)
        }
        result = 'ack'
        break

      case 'ping':
        result = 'pong'
        break

      case 'get_public_key':
        result = ctx.activePublicKeyHex
        break

      case 'sign_event': {
        const template = JSON.parse(request.params[0]) as EventTemplate
        const sign = ctx.getSigningFunction()
        const signed = await sign(template)
        result = JSON.stringify(signed)
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

    // Encrypt and send response
    const response = error
      ? JSON.stringify({ id: request.id, result: '', error })
      : JSON.stringify({ id: request.id, result })

    const encrypted = encrypt(response, conversationKey)
    const responseEvent = finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', clientPk]],
      content: encrypted,
    }, bunkerSk) as unknown as NostrEvent

    await Promise.any(pool.publish(relays, responseEvent))
    log(`Response ${request.id}: ${error ?? 'ok'}`)
  }

  // Build bunker:// URI
  const relayParams = relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')
  const bunkerUrl = `bunker://${bunkerPk}?${relayParams}`

  log(`Bunker started: ${bunkerNpub}`)
  log(`URI: ${bunkerUrl}`)
  log(`Signing as: ${ctx.activeNpub}`)
  if (cliAuthorizedKeys.size > 0) {
    log(`Authorized keys: ${authorizedKeys.size} (${cliAuthorizedKeys.size} CLI + ${bunkerApprovals.length} persisted)`)
  } else {
    log('WARNING: No authorized keys set — accepting requests from anyone')
  }

  return {
    url: bunkerUrl,
    pubkey: bunkerPk,
    npub: bunkerNpub,
    close: () => {
      sub.close()
      pool.destroy()
      bunkerSk.fill(0)
    },
  }
}
