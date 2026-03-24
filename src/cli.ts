#!/usr/bin/env node
import { loadConfig } from './config.js'
import { IdentityContext } from './context.js'
import { RelayPool } from './relay-pool.js'
import { Nip65Manager } from './nip65.js'
import { handleSocialPost, handleSocialReply, handleSocialReact, handleSocialDelete, handleSocialRepost, handleSocialProfileGet, handleSocialProfileSet, handleContactsGet, handleContactsFollow, handleContactsUnfollow } from './social/handlers.js'
import { handleDmSend, handleDmRead } from './social/dm.js'
import { handleNotifications, handleFeed } from './social/notifications.js'
import { handleNipPublish, handleNipRead } from './social/nips.js'
import { handleIdentityList, handleIdentityProve, handleIdentityCreate } from './identity/handlers.js'
import { handleBackupShamir, handleRestoreShamir } from './identity/shamir.js'
import { handleIdentityBackup, handleIdentityRestore, handleIdentityMigrate } from './identity/migration.js'
import { handleRelayInfo, handleRelayList, handleRelaySet, handleRelayAdd } from './relay/handlers.js'
import { handleTrustAttest, handleTrustRead, handleTrustVerify, handleTrustRevoke, handleTrustRequest, handleTrustRequestList, handleTrustProofPublish } from './trust/handlers.js'
import { handleTrustRingProve, handleTrustRingVerify } from './trust/ring.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from './trust/spoken.js'
import { handleDuressConfigure, handleDuressActivate } from './safety/handlers.js'
import { handleZapSend, handleZapBalance, handleZapMakeInvoice, handleZapLookupInvoice, handleZapListTransactions, handleZapReceipts, handleZapDecode } from './zap/handlers.js'
import { handleDecode, handleEncodeNpub, handleEncodeNote, handleEncodeNprofile, handleEncodeNevent, handleVerify, handleEncrypt, handleDecrypt, handleCount, handleFetch } from './util/handlers.js'

const args = process.argv.slice(2)
const command = args[0]

// No command = start MCP server
if (!command || command === 'serve') {
  await import('./index.js')
  process.exit(0)
}

const HELP = `nostr-bray — Sovereign Nostr identities for AI agents

Usage: nostr-bray [command] [args]

Identity:
  whoami                              Show active identity npub
  create                              Generate a fresh identity (mnemonic + npub)
  list                                List all identities
  derive <purpose> [index]            Derive a child identity
  persona <name> [index]              Derive a named persona
  switch <target> [index]             Switch active identity
  prove [blind|full]                  Create a linkage proof
  proof-publish [blind|full]          Publish linkage proof to relays (irreversible)
  backup <dir> [threshold] [shares]   Shamir backup (default 3-of-5)
  restore <file1> <file2> ... -t <n>  Restore from Shamir shards
  identity-backup <pubkey-hex>        Fetch profile/contacts/relays as bundle
  identity-restore <pubkey-hex>       Re-sign events under active identity
  migrate <old-hex> <old-npub>        Migrate identity (preview, add --confirm)

Social:
  post "message"                      Post a text note (kind 1)
  reply <event-id> <pubkey> "text"    Reply to an event
  react <event-id> <pubkey> [emoji]   React to an event
  delete <event-id> [reason]          Request deletion of your event (kind 5)
  repost <event-id> <pubkey>          Repost/boost an event (kind 6)
  profile <pubkey-hex>                Fetch a profile
  profile-set <json>                  Set profile (add --confirm to overwrite)
  contacts <pubkey-hex>               List who a pubkey follows
  follow <pubkey-hex> [relay] [name]  Follow a pubkey
  unfollow <pubkey-hex>               Unfollow a pubkey
  dm <pubkey-hex> "message"           Send NIP-17 encrypted DM
  dm-read                             Read received DMs
  feed [--limit N]                    Fetch text note feed
  notifications [--limit N]           Fetch mentions, replies, reactions, zaps
  nip-publish <id> <title> <file>     Publish a community NIP (kind 30817)
  nip-read [--author X] [--kind N]    Fetch community NIPs

Trust:
  attest <type> <identifier> [subject]  Create kind 31000 attestation
  trust-read [--subject X] [--type X]   Read attestations
  trust-verify <event-json>             Validate attestation structure
  trust-revoke <type> <identifier>      Revoke an attestation
  trust-request <pubkey> <subject> <type>  Send attestation request via DM
  trust-request-list                    Scan DMs for attestation requests
  ring-prove <type> <pk1,pk2,...>       Create ring signature proof
  ring-verify <event-json>              Verify ring signature
  spoken-challenge <secret> <ctx> <ctr> Generate spoken token
  spoken-verify <secret> <ctx> <ctr> <input>  Verify spoken token

Relay:
  relay-list [--compare npub]         List relays for active identity
  relay-set <url1> <url2> ...         Publish kind 10002 relay list (add --confirm)
  relay-add <url> [read|write]        Add relay to active identity
  relay-info <wss://url>              Fetch NIP-11 relay info

Zap:
  zap-send <bolt11>                   Pay invoice via NWC
  zap-balance                         Request wallet balance via NWC
  zap-invoice <msats> [description]   Generate invoice via NWC
  zap-lookup <payment-hash>           Look up invoice status
  zap-transactions [--limit N]        List recent transactions
  zap-receipts [--limit N]            Fetch zap receipts
  zap-decode <bolt11>                 Decode bolt11 invoice

Safety:
  safety-configure [persona-name]     Configure alternative identity
  safety-activate [persona-name]      Switch to alternative identity

Utility:
  decode <nip19>                      Decode npub/nsec/note/nevent/nprofile/naddr
  encode-npub <hex>                   Encode hex pubkey as npub
  encode-note <hex>                   Encode hex event ID as note
  encode-nprofile <hex> [relay,...]   Encode pubkey + relays as nprofile
  encode-nevent <hex> [relay,...]     Encode event ID + relays as nevent
  verify <event-json>                 Verify event hash and signature
  encrypt <pubkey-hex> "plaintext"    NIP-44 encrypt for a recipient
  decrypt <pubkey-hex> <ciphertext>   NIP-44 decrypt from a sender
  count --kinds 1 [--authors <hex>]   Count events matching filter
  fetch <nip19>                       Fetch events by nip19 code

Modes:
  (no command)                        Start MCP server (stdio)
  shell                               Interactive REPL (persistent relay connection)

Environment:
  NOSTR_SECRET_KEY              nsec, hex, or BIP-39 mnemonic
  NOSTR_SECRET_KEY_FILE         Path to secret key file
  NOSTR_RELAYS                  Comma-separated relay URLs
  NWC_URI / NWC_URI_FILE        Nostr Wallet Connect URI
  TOR_PROXY                     SOCKS5h proxy URL`

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

// All other commands need config
const config = loadConfig()
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
})
const nip65 = new Nip65Manager(pool, config.relays)
const ctx = new IdentityContext(config.secretKey, config.secretFormat)
const nwcUri = config.nwcUri

;(config as any).secretKey = ''
;(config as any).nwcUri = undefined

const masterRelays = await nip65.loadForIdentity(ctx.activeNpub)
pool.reconfigure(ctx.activeNpub, masterRelays)

/** Helper: print JSON result */
function out(data: unknown): void { console.log(JSON.stringify(data, null, 2)) }

/** Parse a shell line into args, respecting quotes */
function parseShellLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote: string | null = null
  for (const ch of line) {
    if (inQuote) {
      if (ch === inQuote) { inQuote = null } else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current) { result.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) result.push(current)
  return result
}

async function run(cmdArgs: string[]): Promise<void> {
  const command = cmdArgs[0]

  /** Require arg or throw */
  function req(index: number, usage: string): string {
    const val = cmdArgs[index]
    if (!val) { throw new Error(`Usage: ${usage}`) }
    return val
  }

  function flag(name: string, fallback?: string): string | undefined {
    const i = cmdArgs.indexOf(`--${name}`)
    if (i === -1) return fallback
    return cmdArgs[i + 1] ?? fallback
  }

  function hasFlag(name: string): boolean {
    return cmdArgs.includes(`--${name}`)
  }

  switch (command) {
    // === Identity ===

    case 'whoami':
      console.log(ctx.activeNpub)
      break

    case 'create':
      out(handleIdentityCreate())
      break

    case 'list':
      out(handleIdentityList(ctx))
      break

    case 'derive':
      out(ctx.derive(req(1, 'derive <purpose> [index]'), parseInt(cmdArgs[2] ?? '0', 10)))
      break

    case 'persona':
      out(ctx.derivePersona(req(1, 'persona <name> [index]'), parseInt(cmdArgs[2] ?? '0', 10)))
      break

    case 'switch':
      ctx.switch(req(1, 'switch <target> [index]'), cmdArgs[2] ? parseInt(cmdArgs[2], 10) : undefined)
      console.log(ctx.activeNpub)
      break

    case 'prove':
      out(handleIdentityProve(ctx, { mode: (cmdArgs[1] === 'full' ? 'full' : 'blind') }))
      break

    case 'proof-publish': {
      const r = await handleTrustProofPublish(ctx, pool, {
        mode: (cmdArgs[1] === 'full' ? 'full' : 'blind'),
        confirm: hasFlag('confirm'),
      })
      out(r)
      break
    }

    case 'backup':
      out(handleBackupShamir({
        secret: new Uint8Array(ctx.activePrivateKey),
        threshold: parseInt(cmdArgs[2] ?? '3', 10),
        shares: parseInt(cmdArgs[3] ?? '5', 10),
        outputDir: req(1, 'backup <dir> [threshold] [shares]'),
      }))
      break

    case 'restore': {
      const tFlag = flag('t', '3')!
      const files = args.slice(1).filter(a => a !== '--t' && a !== `-t` && a !== tFlag)
      out({ masterNpub: handleRestoreShamir({ files, threshold: parseInt(tFlag, 10) }) })
      break
    }

    case 'identity-backup':
      out(await handleIdentityBackup(pool, req(1, 'identity-backup <pubkey-hex>'), ctx.activeNpub))
      break

    case 'identity-restore':
      out(await handleIdentityRestore(ctx, pool,
        await handleIdentityBackup(pool, req(1, 'identity-restore <pubkey-hex>'), ctx.activeNpub)))
      break

    case 'migrate':
      out(await handleIdentityMigrate(ctx, pool, {
        oldPubkeyHex: req(1, 'migrate <old-hex> <old-npub>'),
        oldNpub: req(2, 'migrate <old-hex> <old-npub>'),
        confirm: hasFlag('confirm'),
      }))
      break

    // === Social ===

    case 'post':
      out(await handleSocialPost(ctx, pool, { content: req(1, 'post "message"') }))
      break

    case 'reply':
      out(await handleSocialReply(ctx, pool, {
        content: req(3, 'reply <event-id> <pubkey> "text"'),
        replyTo: req(1, 'reply <event-id> <pubkey> "text"'),
        replyToPubkey: req(2, 'reply <event-id> <pubkey> "text"'),
      }))
      break

    case 'react':
      out(await handleSocialReact(ctx, pool, {
        eventId: req(1, 'react <event-id> <pubkey> [emoji]'),
        eventPubkey: req(2, 'react <event-id> <pubkey> [emoji]'),
        reaction: cmdArgs[3] ?? '+',
      }))
      break

    case 'profile':
      out(await handleSocialProfileGet(pool, ctx.activeNpub, req(1, 'profile <pubkey-hex>')))
      break

    case 'profile-set': {
      const profile = JSON.parse(req(1, 'profile-set \'{"name":"..."}\''))
      out(await handleSocialProfileSet(ctx, pool, { profile, confirm: hasFlag('confirm') }))
      break
    }

    case 'delete':
      out(await handleSocialDelete(ctx, pool, {
        eventId: req(1, 'delete <event-id> [reason]'),
        reason: cmdArgs[2],
      }))
      break

    case 'repost':
      out(await handleSocialRepost(ctx, pool, {
        eventId: req(1, 'repost <event-id> <pubkey>'),
        eventPubkey: req(2, 'repost <event-id> <pubkey>'),
      }))
      break

    case 'contacts':
      out(await handleContactsGet(pool, ctx.activeNpub, req(1, 'contacts <pubkey-hex>')))
      break

    case 'follow':
      out(await handleContactsFollow(ctx, pool, {
        pubkeyHex: req(1, 'follow <pubkey-hex> [relay] [petname]'),
        relay: cmdArgs[2],
        petname: cmdArgs[3],
      }))
      break

    case 'unfollow':
      out(await handleContactsUnfollow(ctx, pool, {
        pubkeyHex: req(1, 'unfollow <pubkey-hex>'),
      }))
      break

    case 'dm':
      out(await handleDmSend(ctx, pool, {
        recipientPubkeyHex: req(1, 'dm <pubkey-hex> "message"'),
        message: req(2, 'dm <pubkey-hex> "message"'),
        nip04: hasFlag('nip04'),
        nip04Enabled: config.nip04Enabled,
      }))
      break

    case 'dm-read':
      out(await handleDmRead(ctx, pool))
      break

    case 'feed':
      out(await handleFeed(ctx, pool, { limit: parseInt(flag('limit', '20')!, 10) }))
      break

    case 'nip-publish': {
      const id = req(1, 'nip-publish <identifier> <title> <content-or-file>')
      const title = req(2, 'nip-publish <identifier> <title> <content-or-file>')
      let content = req(3, 'nip-publish <identifier> <title> <content-or-file>')
      // If content looks like a file path, read it
      const { existsSync, readFileSync } = await import('node:fs')
      if (existsSync(content)) content = readFileSync(content, 'utf-8')
      const kindsStr = flag('kinds')
      const kinds = kindsStr ? kindsStr.split(',').map(Number) : undefined
      out(await handleNipPublish(ctx, pool, { identifier: id, title, content, kinds }))
      break
    }

    case 'nip-read':
      out(await handleNipRead(pool, ctx.activeNpub, {
        author: flag('author'),
        identifier: flag('identifier'),
        kind: flag('kind') ? parseInt(flag('kind')!, 10) : undefined,
      }))
      break

    case 'notifications':
      out(await handleNotifications(ctx, pool, { limit: parseInt(flag('limit', '50')!, 10) }))
      break

    // === Trust ===

    case 'attest':
      out(await handleTrustAttest(ctx, pool, {
        type: req(1, 'attest <type> <identifier> [subject]'),
        identifier: cmdArgs[2],
        subject: cmdArgs[3],
      }))
      break

    case 'trust-read':
      out(await handleTrustRead(pool, ctx.activeNpub, {
        subject: flag('subject'),
        type: flag('type'),
        attestor: flag('attestor'),
      }))
      break

    case 'trust-verify':
      out(handleTrustVerify(JSON.parse(req(1, 'trust-verify <event-json>'))))
      break

    case 'trust-revoke':
      out(await handleTrustRevoke(ctx, pool, {
        type: req(1, 'trust-revoke <type> <identifier>'),
        identifier: req(2, 'trust-revoke <type> <identifier>'),
      }))
      break

    case 'trust-request':
      out(await handleTrustRequest(ctx, pool, {
        recipientPubkeyHex: req(1, 'trust-request <pubkey> <subject> <type>'),
        subject: req(2, 'trust-request <pubkey> <subject> <type>'),
        attestationType: req(3, 'trust-request <pubkey> <subject> <type>'),
      }))
      break

    case 'trust-request-list':
      out(await handleTrustRequestList(ctx, pool))
      break

    case 'ring-prove': {
      const ringKeys = req(2, 'ring-prove <type> <pk1,pk2,...>').split(',')
      out(await handleTrustRingProve(ctx, pool, {
        ring: ringKeys,
        attestationType: req(1, 'ring-prove <type> <pk1,pk2,...>'),
      }))
      break
    }

    case 'ring-verify':
      out(handleTrustRingVerify(JSON.parse(req(1, 'ring-verify <event-json>'))))
      break

    case 'spoken-challenge':
      out(handleTrustSpokenChallenge({
        secret: req(1, 'spoken-challenge <secret> <context> <counter>'),
        context: req(2, 'spoken-challenge <secret> <context> <counter>'),
        counter: parseInt(req(3, 'spoken-challenge <secret> <context> <counter>'), 10),
      }))
      break

    case 'spoken-verify':
      out(handleTrustSpokenVerify({
        secret: req(1, 'spoken-verify <secret> <ctx> <ctr> <input>'),
        context: req(2, 'spoken-verify <secret> <ctx> <ctr> <input>'),
        counter: parseInt(req(3, 'spoken-verify <secret> <ctx> <ctr> <input>'), 10),
        input: req(4, 'spoken-verify <secret> <ctx> <ctr> <input>'),
      }))
      break

    // === Relay ===

    case 'relay-list':
      out(handleRelayList(ctx, pool, flag('compare')))
      break

    case 'relay-set': {
      const urls = args.slice(1).filter(a => !a.startsWith('--'))
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

    // === Zap ===

    case 'zap-send':
      out(await handleZapSend(ctx, pool, { invoice: req(1, 'zap-send <bolt11>'), nwcUri }))
      break

    case 'zap-balance':
      out(await handleZapBalance(ctx, pool, { nwcUri }))
      break

    case 'zap-invoice':
      out(await handleZapMakeInvoice(ctx, pool, {
        amountMsats: parseInt(req(1, 'zap-invoice <msats> [description]'), 10),
        description: cmdArgs[2],
        nwcUri,
      }))
      break

    case 'zap-lookup':
      out(await handleZapLookupInvoice(ctx, pool, { paymentHash: req(1, 'zap-lookup <payment-hash>'), nwcUri }))
      break

    case 'zap-transactions':
      out(await handleZapListTransactions(ctx, pool, {
        limit: parseInt(flag('limit', '10')!, 10),
        nwcUri,
      }))
      break

    case 'zap-receipts':
      out(await handleZapReceipts(ctx, pool, { limit: parseInt(flag('limit', '20')!, 10) }))
      break

    case 'zap-decode':
      out(handleZapDecode(req(1, 'zap-decode <bolt11>')))
      break

    // === Safety ===

    case 'safety-configure':
      out(handleDuressConfigure(ctx, pool, { personaName: cmdArgs[1] }))
      break

    case 'safety-activate':
      out(handleDuressActivate(ctx, { personaName: cmdArgs[1] }))
      break

    // === Utility ===

    case 'decode':
      out(handleDecode(req(1, 'decode <nip19>')))
      break

    case 'encode-npub':
      console.log(handleEncodeNpub(req(1, 'encode-npub <hex>')))
      break

    case 'encode-note':
      console.log(handleEncodeNote(req(1, 'encode-note <hex>')))
      break

    case 'encode-nprofile': {
      const relays = cmdArgs[2] ? cmdArgs[2].split(',') : undefined
      console.log(handleEncodeNprofile(req(1, 'encode-nprofile <hex> [relay,...]'), relays))
      break
    }

    case 'encode-nevent': {
      const relays = cmdArgs[2] ? cmdArgs[2].split(',') : undefined
      console.log(handleEncodeNevent(req(1, 'encode-nevent <hex> [relay,...]'), relays))
      break
    }

    case 'verify':
      out(handleVerify(JSON.parse(req(1, 'verify <event-json>'))))
      break

    case 'encrypt': {
      const skHex = Buffer.from(ctx.activePrivateKey).toString('hex')
      console.log(handleEncrypt(skHex, req(1, 'encrypt <pubkey-hex> "plaintext"'), req(2, 'encrypt <pubkey-hex> "plaintext"')))
      break
    }

    case 'decrypt': {
      const skHex = Buffer.from(ctx.activePrivateKey).toString('hex')
      console.log(handleDecrypt(skHex, req(1, 'decrypt <pubkey-hex> <ciphertext>'), req(2, 'decrypt <pubkey-hex> <ciphertext>')))
      break
    }

    case 'count': {
      const filter: Record<string, unknown> = {}
      const kinds = flag('kinds')
      if (kinds) filter.kinds = kinds.split(',').map(Number)
      const authors = flag('authors')
      if (authors) filter.authors = authors.split(',')
      const since = flag('since')
      if (since) filter.since = parseInt(since, 10)
      out(await handleCount(pool, ctx.activeNpub, filter as any))
      break
    }

    case 'fetch':
      out(await handleFetch(pool, ctx.activeNpub, req(1, 'fetch <nip19>')))
      break

    default:
      throw new Error(`Unknown command: ${command}. Run --help for usage.`)
  }
}

// === Shell mode ===

const ALL_COMMANDS = [
  'whoami', 'create', 'list', 'derive', 'persona', 'switch', 'prove', 'proof-publish',
  'backup', 'restore', 'identity-backup', 'identity-restore', 'migrate',
  'post', 'reply', 'react', 'delete', 'repost', 'profile', 'profile-set', 'contacts', 'follow', 'unfollow', 'dm', 'dm-read', 'feed', 'notifications', 'nip-publish', 'nip-read',
  'attest', 'trust-read', 'trust-verify', 'trust-revoke', 'trust-request', 'trust-request-list',
  'ring-prove', 'ring-verify', 'spoken-challenge', 'spoken-verify',
  'relay-list', 'relay-set', 'relay-add', 'relay-info',
  'zap-send', 'zap-balance', 'zap-invoice', 'zap-lookup', 'zap-transactions', 'zap-receipts', 'zap-decode',
  'safety-configure', 'safety-activate',
  'decode', 'encode-npub', 'encode-note', 'encode-nprofile', 'encode-nevent',
  'verify', 'encrypt', 'decrypt', 'count', 'fetch',
  'help', 'exit',
]

async function shell(): Promise<void> {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const parts = line.split(/\s+/)
      if (parts.length <= 1) {
        const hits = ALL_COMMANDS.filter(c => c.startsWith(line))
        return [hits.length ? hits : ALL_COMMANDS, line]
      }
      return [[], line]
    },
  })

  console.log(`nostr-bray shell — ${ctx.activeNpub}`)
  console.log('Type a command, or "help" / "exit".\n')

  const prompt = (): Promise<string> => new Promise(resolve => {
    rl.question('bray> ', resolve)
  })

  while (true) {
    const line = await prompt()
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed === 'exit' || trimmed === 'quit') break
    if (trimmed === 'help') { console.log(HELP); continue }

    const shellArgs = parseShellLine(trimmed)
    try {
      await run(shellArgs)
    } catch (e: any) {
      console.error(e.message)
    }
  }

  rl.close()
}

// === Entry point ===

if (command === 'shell') {
  try {
    await shell()
  } finally {
    ctx.destroy()
    pool.close()
  }
} else {
  try {
    await run(args)
  } catch (e: any) {
    console.error(e.message)
    process.exit(1)
  } finally {
    ctx.destroy()
    pool.close()
  }
}
