#!/usr/bin/env node
import { loadConfig } from '../config.js'
import { IdentityContext } from '../context.js'
import { RelayPool } from '../relay-pool.js'
import { Nip65Manager } from '../nip65.js'
import { getCommandHelp } from '../help.js'

import { COMPOUND_COMMANDS, OFFLINE_COMMANDS, makeHelpers, resolveOutputMode, parseShellLine } from './dispatch.js'
import * as identity from './commands/identity.js'
import * as social from './commands/social.js'
import * as trust from './commands/trust.js'
import * as relay from './commands/relay.js'
import * as zap from './commands/zap.js'
import * as safety from './commands/safety.js'
import * as event from './commands/event.js'
import * as util from './commands/util.js'
import * as bunker from './commands/bunker.js'
import * as musig2 from './commands/musig2.js'
import * as sync from './commands/sync.js'
import * as admin from './commands/admin.js'
import * as wallet from './commands/wallet.js'

const args = process.argv.slice(2)

// Strip global flags before command detection so `--bunker <uri> whoami` works.
for (const flag of ['--bunker', '--key']) {
  const i = args.indexOf(flag)
  if (i !== -1) {
    const envKey = flag === '--bunker' ? 'BUNKER_URI' : 'NOSTR_SECRET_KEY'
    process.env[envKey] = args[i + 1]
    args.splice(i, 2)
  }
}

const command = args[0]

// No command = start MCP server.
if (!command) {
  await import('../index.js')
  await new Promise(() => {})
}

// Bunker = NIP-46 remote signer (daemon or one-shot sign) — dispatched before ctx setup.
if (command === 'bunker' && !args.includes('--help')) {
  await bunker.dispatch(args)
}

// Serve = in-memory test relay
if (command === 'serve' && !args.includes('--help')) {
  const { startRelay } = await import('../serve.js')
  const hostname = args.includes('--hostname') ? args[args.indexOf('--hostname') + 1] : 'localhost'
  const port = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 10547
  const eventsFile = args.includes('--events') ? args[args.indexOf('--events') + 1] : undefined
  const relayServer = startRelay({ hostname, port, eventsFile, quiet: args.includes('--quiet') })
  console.error(`nostr-bray test relay running at ${relayServer.url}`)
  console.error('Press Ctrl+C to stop')
  process.on('SIGINT', () => { relayServer.close(); process.exit(0) })
  process.on('SIGTERM', () => { relayServer.close(); process.exit(0) })
  await new Promise(() => {})
}

// Per-command help: `nostr-bray post --help`
if (args.includes('--help') && command && command !== 'help' && command !== '--help' && command !== '-h') {
  const help = getCommandHelp(command)
  if (help) { console.log(help); process.exit(0) }
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
  proof publish [blind|full]          Publish linkage proof to relays (irreversible)
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
  profile set <json>                  Set profile (add --confirm to overwrite)
  contacts <pubkey-hex>               List who a pubkey follows
  follow <pubkey-hex> [relay] [name]  Follow a pubkey
  unfollow <pubkey-hex>               Unfollow a pubkey
  dm <pubkey-hex> "message"           Send NIP-17 encrypted DM
  dm read                             Read received DMs
  feed [--limit N]                    Fetch text note feed
  notifications [--limit N]           Fetch mentions, replies, reactions, zaps
  nip publish <id> <title> <file>     Publish a community NIP (kind 30817)
  nip read [--author X] [--kind N]    Fetch community NIPs
  blossom-upload <server> <file>      Upload file to blossom media server
  blossom-list <server> <pubkey>      List blobs on blossom server
  blossom-delete <server> <sha256>    Delete blob from blossom server
  group-info <group-id>              Fetch NIP-29 group metadata
  group-chat <group-id> [--limit N]  Fetch group chat messages
  group-send <group-id> "message"    Send message to group
  group-members <group-id>           List group members
  group-create [<group-id>] [--name X] [--about X] [--picture X] [--open|--closed]  Create NIP-29 group
  group-update <group-id> [--name X] [--about X] [--picture X] [--open|--closed]    Update group metadata
  group-add-user <group-id> <pubkey-hex> [--role admin]  Add/update user in group
  group-remove-user <group-id> <pubkey-hex>              Remove user from group
  group-set-roles <group-id> --role name[:perm,perm] ... Define group roles

Trust:
  attest <event-id>                     Verify someone's assertion (assertion-first)
  claim <type>                          Make a direct claim (endorsement, vouch, review)
  trust read [--subject X] [--type X]   Read attestations
  trust verify <event-json>             Validate attestation structure
  trust revoke <type> <identifier>      Revoke an attestation
  trust-request <pubkey> <subject> <type>  Send attestation request via DM
  trust-request-list                    Scan DMs for attestation requests
  trust-rank <event.json|->             Annotate event with trust score and attesting paths
  ring prove <type> <pk1,pk2,...>       Create ring signature proof
  ring verify <event-json>              Verify ring signature
  spoken-challenge <secret> <ctx> <ctr> Generate spoken token
  spoken-verify <secret> <ctx> <ctr> <input>  Verify spoken token

Relay:
  relay-list [--compare npub]         List relays for active identity
  relay set <url1> <url2> ...         Publish kind 10002 relay list (add --confirm)
  relay add <url> [read|write]        Add relay to active identity
  relay-info <wss://url>              Fetch NIP-11 relay info
  relay curl <url> [--path /ep] [--method GET|POST] [--body json] [--auth]  HTTP request to relay
  outbox relays <npub|hex|nprofile>   Resolve NIP-65 read/write relays for any pubkey
  outbox publish <event.json|->       Publish event to author's outbox + p-tag inboxes (NIP-65)

Sync (filter-based relay sync):
  sync pull <relay-url> [--kinds N,N] [--authors hex] [--since ts] [--limit N]
  sync push <relay-url> --events <jsonl-file>

Admin (NIP-86 relay management):
  admin <relay-url> allowpubkey|banpubkey|listallowedpubkeys|listbannedpubkeys
  admin <relay-url> allowkind|bankind|listallowedkinds|listbannedkinds [kind]
  admin <relay-url> blockip|unblockip|listblockedips [ip]

Wallet (NIP-47 Nostr Wallet Connect):
  wallet connect <nwc-url>            Store NWC URI for the active identity
  wallet disconnect                   Remove stored NWC URI for the active identity
  wallet status                       Show configured wallet pubkey and relay
  wallet pay <bolt11>                 Pay a Lightning invoice via NWC
  wallet balance                      Request wallet balance via NWC
  wallet history [--limit N]          List recent Lightning transactions via NWC

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
  req [--kinds N,N] [--authors hex,hex] [--since ts] [--limit N] [--relay url] [--min-trust level]  Query events
  event --kind N [--tag k=v] [--content s] [--relay url]  Build and publish an arbitrary event
  publish-raw [--file path] [--report] [--timeout ms] [--quorum n]  Sign+broadcast event (--report shows per-relay table)
  subscribe [--kinds N,N] [--authors hex] [--relay url]  Live-tail events to stdout (JSONL) until SIGINT
  decode <nip19>                      Decode npub/nsec/note/nevent/nprofile/naddr
  encode npub <hex>                   Encode hex pubkey as npub
  encode note <hex>                   Encode hex event ID as note
  encode nprofile <hex> [relay,...]   Encode pubkey + relays as nprofile
  encode nevent <hex> [relay,...]     Encode event ID + relays as nevent
  encode nsec <hex>                   Encode hex private key as nsec
  key-public <nsec-or-hex>            Derive pubkey from secret key
  key encrypt <nsec-or-hex> <pass>    Encrypt key as ncryptsec (NIP-49)
  key decrypt <ncryptsec> <pass>      Decrypt ncryptsec to verify pubkey
  filter <event-json> <filter-json>   Test if event matches filter
  nips                                List all official NIPs
  nip <number>                        Show a specific NIP
  verify <event-json>                 Verify event hash and signature
  encrypt <pubkey-hex> "plaintext"    NIP-44 encrypt for a recipient
  decrypt <pubkey-hex> <ciphertext>   NIP-44 decrypt from a sender
  count --kinds 1 [--authors <hex>]   Count events matching filter
  fetch <nip19>                       Fetch events by nip19 code

MuSig2 (BIP-327 multi-signature):
  musig2 key                                    Generate a musig2 key pair
  musig2 nonce --sk <hex>                       Generate a signing nonce (keep secNonce secret)
  musig2 partial-sign --sk <hex> --sec-nonce <hex> --pub-nonces <n1,n2,...> --pub-keys <pk1,pk2,...> --msg <32-byte-hex>
  musig2 aggregate --partial-sigs <s1,s2,...> --pub-nonces <n1,n2,...> --pub-keys <pk1,pk2,...> --msg <32-byte-hex>

Modes:
  (no command)                        Start MCP server (stdio)
  serve [--port N] [--events file]    Start in-memory test relay
  bunker connect <bunker://…>              Save remote bunker URI for future commands
  bunker authorize <hex-pubkey>           Pre-authorise an app pubkey on the local bunker
  bunker status                           Show saved bunker connection state
  bunker daemon [--authorized-keys pk,pk]  Start NIP-46 remote signer daemon
  shell                               Interactive REPL (persistent relay connection)

Environment:
  NOSTR_SECRET_KEY              nsec, hex, or BIP-39 mnemonic
  NOSTR_SECRET_KEY_FILE         Path to secret key file
  BUNKER_URI / BUNKER_URI_FILE  bunker:// URI (use INSTEAD of secret key)
  NOSTR_RELAYS                  Comma-separated relay URLs
  NWC_URI / NWC_URI_FILE        Nostr Wallet Connect URI
  TOR_PROXY                     SOCKS5h proxy URL
  NOSTR_BRAY_OUTPUT             Default output: "human" (default) or "json"

Quick examples:
  nostr-bray whoami                           # show your npub
  nostr-bray post "gm nostr"                  # publish a note
  nostr-bray persona work                     # derive work identity
  nostr-bray dm abc123... "secret message"    # send encrypted DM (or: dm read)
  nostr-bray decode npub1...                  # decode any nip19 entity
  nostr-bray nips                             # browse official NIPs
  nostr-bray shell                            # interactive mode

Flags:
  --bunker <uri>                      Use bunker:// URI (overrides env/config)
  --key <nsec|hex|mnemonic>           Use this secret key (overrides env/config)
  --json                              Output raw JSON (for piping/scripts)
  --human                             Force human-readable output
  --help                              Show help for a command

Use 'nostr-bray <command> --help' for detailed help on any command.

Learn more:
  Guide:     https://github.com/forgesworn/bray/blob/main/docs/guide.md
  Examples:  https://github.com/forgesworn/bray/tree/main/examples
  npm:       https://www.npmjs.com/package/nostr-bray`

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

// All other commands need config + ctx + pool
const config = await loadConfig()
const pool = new RelayPool({
  torProxy: config.torProxy,
  allowClearnet: config.allowClearnetWithTor || !config.torProxy,
  defaultRelays: config.relays,
})
const nip65 = new Nip65Manager(pool, config.relays)

let ctx: any
if (config.bunkerUri) {
  const { BunkerContext } = await import('../bunker-context.js')
  const { HeartwoodContext } = await import('../heartwood-context.js')
  ctx = await BunkerContext.connect(config.bunkerUri)
  await ctx.resolvePublicKey()
  const hw = await HeartwoodContext.probe(ctx)
  if (hw) ctx = hw
  console.error(`Connected to ${hw ? 'Heartwood' : 'bunker'} — signing as ${ctx.activeNpub}`)
} else {
  ctx = new IdentityContext(config.secretKey, config.secretFormat)
}
const globalNwcUri = config.nwcUri
const walletsFile = config.walletsFile

;(config as any).secretKey = ''
;(config as any).nwcUri = undefined

// Only fetch NIP-65 relay list for commands that need network access.
const effectiveCommand = COMPOUND_COMMANDS.has(`${command}-${args[1]}`) ? `${command}-${args[1]}` : command
if (!OFFLINE_COMMANDS.has(effectiveCommand)) {
  const masterRelays = await nip65.loadForIdentity(ctx.activeNpub)
  pool.reconfigure(ctx.activeNpub, masterRelays)
}

const envDefault = process.env.NOSTR_BRAY_OUTPUT === 'json' ? 'json' : 'human'

// Category sets for routing
const IDENTITY_CMDS = new Set([
  'whoami', 'create', 'list', 'derive', 'persona', 'switch', 'prove', 'proof-publish',
  'backup', 'restore', 'identity-backup', 'identity-restore', 'migrate',
])
const SOCIAL_CMDS = new Set([
  'post', 'reply', 'react', 'delete', 'repost', 'profile', 'profile-set',
  'contacts', 'follow', 'unfollow', 'dm', 'dm-read', 'feed', 'notifications',
  'nip-publish', 'nip-read',
  'blossom-upload', 'blossom-list', 'blossom-delete',
  'group-info', 'group-chat', 'group-send', 'group-members',
  'group-create', 'group-update', 'group-add-user', 'group-remove-user', 'group-set-roles',
])
const TRUST_CMDS = new Set([
  'attest', 'claim', 'trust-read', 'trust-verify', 'trust-revoke', 'trust-request', 'trust-request-list', 'trust-rank',
  'ring-prove', 'ring-verify', 'spoken-challenge', 'spoken-verify',
])
const RELAY_CMDS = new Set(['relay-list', 'relay-set', 'relay-add', 'relay-info', 'req', 'relay-curl', 'subscribe', 'outbox-relays', 'outbox-publish'])
const ZAP_CMDS = new Set(['zap-send', 'zap-balance', 'zap-invoice', 'zap-lookup', 'zap-transactions', 'zap-receipts', 'zap-decode'])
const SAFETY_CMDS = new Set(['safety-configure', 'safety-activate'])
const EVENT_CMDS = new Set(['event', 'publish-raw'])
const UTIL_CMDS = new Set([
  'decode', 'encode-npub', 'encode-note', 'encode-nprofile', 'encode-nevent', 'encode-nsec',
  'key-public', 'key-encrypt', 'key-decrypt', 'filter', 'nips', 'nip', 'verify', 'encrypt', 'decrypt', 'count', 'fetch',
])
const MUSIG2_CMDS = new Set(['musig2-key', 'musig2-nonce', 'musig2-partial-sign', 'musig2-aggregate'])
const SYNC_CMDS = new Set(['sync-pull', 'sync-push'])
const ADMIN_CMDS = new Set([
  'admin-allowpubkey', 'admin-banpubkey', 'admin-listallowedpubkeys', 'admin-listbannedpubkeys',
  'admin-allowkind', 'admin-bankind', 'admin-listallowedkinds', 'admin-listbannedkinds',
  'admin-blockip', 'admin-unblockip', 'admin-listblockedips',
])
const WALLET_CMDS = new Set([
  'wallet-connect', 'wallet-disconnect', 'wallet-status', 'wallet-pay', 'wallet-balance', 'wallet-history',
])

async function run(cmdArgs: string[]): Promise<void> {
  const outputMode = resolveOutputMode(cmdArgs, envDefault)

  // Normalise `noun subverb [args...]` → `noun-subverb [args...]`
  const maybeCompound = cmdArgs[1] && !cmdArgs[1].startsWith('-')
    ? `${cmdArgs[0]}-${cmdArgs[1]}`
    : undefined
  if (maybeCompound && COMPOUND_COMMANDS.has(maybeCompound)) {
    cmdArgs = [maybeCompound, ...cmdArgs.slice(2)]
  }

  const h = makeHelpers(cmdArgs, outputMode)
  const cmd = cmdArgs[0]

  if (IDENTITY_CMDS.has(cmd)) return identity.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (SOCIAL_CMDS.has(cmd)) return social.dispatch(cmd, cmdArgs, h, ctx, pool, config)
  if (TRUST_CMDS.has(cmd)) return trust.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (RELAY_CMDS.has(cmd)) return relay.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (ZAP_CMDS.has(cmd)) return zap.dispatch(cmd, cmdArgs, h, ctx, pool, { globalNwcUri, walletsFile: walletsFile ?? '' })
  if (SAFETY_CMDS.has(cmd)) return safety.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (EVENT_CMDS.has(cmd)) return event.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (UTIL_CMDS.has(cmd)) return util.dispatch(cmd, cmdArgs, h, ctx, pool)
  if (MUSIG2_CMDS.has(cmd)) return musig2.dispatch(cmd, cmdArgs, h)
  if (SYNC_CMDS.has(cmd)) return sync.dispatch(cmd, cmdArgs, h, ctx, pool, ctx.activeNpub)
  if (ADMIN_CMDS.has(cmd)) return admin.dispatch(cmd, cmdArgs, h, ctx)
  if (WALLET_CMDS.has(cmd)) return wallet.dispatch(cmd, cmdArgs, h, ctx, pool, { globalNwcUri, walletsFile: walletsFile ?? '' })

  throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
}

// === Shell mode ===

const ALL_COMMANDS = [
  'whoami', 'create', 'list', 'derive', 'persona', 'switch', 'prove', 'proof-publish',
  'backup', 'restore', 'identity-backup', 'identity-restore', 'migrate',
  'post', 'reply', 'react', 'delete', 'repost', 'profile', 'profile-set', 'contacts', 'follow', 'unfollow', 'dm', 'dm-read', 'feed', 'notifications', 'nip-publish', 'nip-read',
  'attest', 'trust-read', 'trust-verify', 'trust-revoke', 'trust-request', 'trust-request-list',
  'ring-prove', 'ring-verify', 'spoken-challenge', 'spoken-verify',
  'relay-list', 'relay-set', 'relay-add', 'relay-info', 'subscribe', 'outbox-relays', 'outbox-publish',
  'zap-send', 'zap-balance', 'zap-invoice', 'zap-lookup', 'zap-transactions', 'zap-receipts', 'zap-decode',
  'safety-configure', 'safety-activate',
  'blossom-upload', 'blossom-list', 'blossom-delete',
  'group-info', 'group-chat', 'group-send', 'group-members',
  'group-create', 'group-update', 'group-add-user', 'group-remove-user', 'group-set-roles',
  'publish-raw',
  'decode', 'encode-npub', 'encode-note', 'encode-nprofile', 'encode-nevent', 'encode-nsec',
  'key-public', 'key-encrypt', 'key-decrypt', 'filter', 'nips', 'nip', 'verify', 'encrypt', 'decrypt', 'count', 'fetch',
  'musig2-key', 'musig2-nonce', 'musig2-partial-sign', 'musig2-aggregate',
  'sync-pull', 'sync-push',
  'admin-allowpubkey', 'admin-banpubkey', 'admin-listallowedpubkeys', 'admin-listbannedpubkeys',
  'admin-allowkind', 'admin-bankind', 'admin-listallowedkinds', 'admin-listbannedkinds',
  'admin-blockip', 'admin-unblockip', 'admin-listblockedips',
  'wallet-connect', 'wallet-disconnect', 'wallet-status', 'wallet-pay', 'wallet-balance', 'wallet-history',
  'relay-curl',
  'bunker',
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

    if (shellArgs.includes('--help') && shellArgs[0]) {
      const h = getCommandHelp(shellArgs[0])
      if (h) { console.log(h); continue }
    }

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
