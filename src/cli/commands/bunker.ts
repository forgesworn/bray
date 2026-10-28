/**
 * Bunker command module.
 * bunker sign, bunker connect, bunker pair, bunker authorize, bunker status, and bunker daemon
 * are all dispatched BEFORE ctx/pool setup in index.ts, so this module does its
 * own config/context construction.
 */

/** Filename used to persist the active bunker URI inside the bray state dir. */
const BUNKER_URI_FILE = 'bunker-uri'

/**
 * Apply `--persona <name>` to a bunker context: switch signing to that named
 * sub-identity (the same key `nsec-tree-cli export nsec <name>` yields). With no
 * `--persona`, the bunker signs as the configured master identity, unchanged.
 */
export async function applyBunkerPersona(
  ctx: { use(purpose: string, index?: number): Promise<void> },
  args: string[],
): Promise<string | undefined> {
  const i = args.indexOf('--persona')
  const value = i >= 0 ? args[i + 1] : undefined
  if (value && !value.startsWith('--')) {
    await ctx.use(value)
    return value
  }
  return undefined
}

export async function dispatch(args: string[]): Promise<void> {
  // Accept `bunker daemon` as alias for `bunker` (start daemon)
  if (args[1] === 'daemon') args.splice(1, 1)

  // ── bunker connect <bunker-url> ─────────────────────────────────────────────
  // Connect to a remote NIP-46 bunker or Heartwood device, verify the
  // connection, then persist the URI so subsequent bray commands use it
  // automatically without needing BUNKER_URI in the environment.
  if (args[1] === 'connect') {
    const uri = args[2]
    if (!uri) {
      console.error('usage: bray bunker connect <bunker://…>')
      process.exit(1)
    }

    const { BunkerContext } = await import('../../bunker-context.js')
    const { HeartwoodContext } = await import('../../heartwood-context.js')
    const { writeStateFile } = await import('../../state.js')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any
    try {
      client = await BunkerContext.connect(uri)
      await client.resolvePublicKey()
    } catch (err) {
      console.error(`bunker connect: failed to connect — ${(err as Error).message}`)
      process.exit(1)
    }

    const hw = await HeartwoodContext.probe(client)
    const isHeartwood = hw !== null

    // Persist URI in state dir so loadConfig() picks it up on next invocation.
    // Written with 0600 permissions by writeStateFile.
    writeStateFile(BUNKER_URI_FILE, { uri })

    const npub = client.activeNpub
    client.destroy()

    console.log(JSON.stringify({
      connected: true,
      npub,
      heartwood: isHeartwood,
      saved: true,
    }, null, 2))
    process.exit(0)
  }

  // ── bunker pair [--relay <url>]... [--timeout <s>] [--expect <npub>] [--yes] ─
  // Client-initiated NIP-46 pairing: print a nostrconnect:// URI to paste or
  // scan into a signer app (Amber, nsec.app and others), wait for the signer
  // to answer, confirm the account it signs as, then save it so later bray
  // commands and the MCP server sign through it without BUNKER_URI.
  if (args[1] === 'pair') {
    const usage = 'usage: bray bunker pair [--relay <wss://…>]... [--timeout <seconds>] [--expect <npub>] [--yes]'
    const relays: string[] = []
    let timeoutSeconds: number | undefined
    let expect: string | undefined
    let yes = false
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--relay' && args[i + 1]) relays.push(args[++i])
      else if (args[i] === '--timeout' && args[i + 1]) timeoutSeconds = Number(args[++i])
      else if (args[i] === '--expect' && args[i + 1]) expect = args[++i]
      else if (args[i] === '--yes') yes = true
      else {
        console.error(usage)
        process.exit(1)
      }
    }
    if (timeoutSeconds !== undefined && (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1)) {
      console.error('bunker pair: --timeout must be a whole number of seconds')
      process.exit(1)
    }
    let expectedNpub: string | undefined
    if (expect !== undefined) {
      const { npubEncode, decode } = await import('nostr-tools/nip19')
      try {
        if (/^[0-9a-f]{64}$/i.test(expect)) {
          expectedNpub = npubEncode(expect.toLowerCase())
        } else {
          const decoded = decode(expect)
          expectedNpub = decoded.type === 'npub' ? npubEncode(decoded.data) : undefined
        }
      } catch { expectedNpub = undefined }
      if (!expectedNpub) {
        console.error('bunker pair: --expect must be an npub or a 64-character hex pubkey')
        process.exit(1)
      }
    }
    const interactive = process.stdin.isTTY === true && process.stderr.isTTY === true
    if (!expectedNpub && !yes && !interactive) {
      console.error('bunker pair: not running in a terminal, so the account cannot be confirmed. Pass --expect <npub> (the account you mean to sign as), or --yes to accept whichever signer answers.')
      process.exit(1)
    }

    const { loadConfigFile } = await import('../../config.js')
    const file = loadConfigFile()
    if (relays.length === 0 && process.env.NOSTR_RELAYS) {
      relays.push(...process.env.NOSTR_RELAYS.split(','))
    }
    if (relays.length === 0) relays.push(...(file.relays ?? []))
    if (relays.length === 0) {
      console.error('bunker pair: no relays. Pass --relay <wss://…> (one your signer app can reach), or set NOSTR_RELAYS.')
      process.exit(1)
    }

    // A configured signer or key takes precedence over the saved pairing.
    const overriding = [
      process.env.BUNKER_URI && 'BUNKER_URI',
      process.env.BUNKER_URI_FILE && 'BUNKER_URI_FILE',
      process.env.NOSTR_SECRET_KEY && 'NOSTR_SECRET_KEY',
      process.env.NOSTR_SECRET_KEY_FILE && 'NOSTR_SECRET_KEY_FILE',
      process.env.NOSTR_NCRYPTSEC && 'NOSTR_NCRYPTSEC',
      process.env.NOSTR_NCRYPTSEC_FILE && 'NOSTR_NCRYPTSEC_FILE',
      file.bunkerUriFile && 'bunkerUriFile in the config file',
      file.secretKeyFile && 'secretKeyFile in the config file',
      file.ncryptsecFile && 'ncryptsecFile in the config file',
    ].filter((v): v is string => typeof v === 'string')

    const { pairWithNostrConnect, PairingDeclinedError } = await import('../../bunker-pair.js')
    try {
      const result = await pairWithNostrConnect({
        relays,
        timeoutMs: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
        allowPrivateRelays: process.env.BRAY_ALLOW_PRIVATE_RELAYS === '1',
        torProxy: process.env.TOR_PROXY ?? file.torProxy,
        allowClearnetWithTor: process.env.ALLOW_CLEARNET_WITH_TOR === '1' || file.allowClearnetWithTor === true,
        onRelayUnreachable: (relay, reason) => {
          console.error(`Leaving out ${relay}: ${reason}`)
        },
        onUri: uri => {
          console.error('Paste or scan this into your signer app (Amber, nsec.app and others) to pair with bray.')
          console.error('It works once, for whoever answers first, so do not share it or leave it on screen:\n')
          console.error(uri)
          console.error('\nWaiting for the signer to answer...')
        },
        confirm: async npub => {
          if (expectedNpub) {
            if (npub === expectedNpub) return true
            console.error(`bunker pair: the signer answered as ${npub}, not ${expectedNpub}. Nothing was saved.`)
            return false
          }
          if (yes) return true
          const { createInterface } = await import('node:readline/promises')
          const rl = createInterface({ input: process.stdin, output: process.stderr })
          try {
            const reply = await rl.question(`The signer will sign as ${npub}. Is that your account? [y/N] `)
            return /^y(es)?$/i.test(reply.trim())
          } finally {
            rl.close()
          }
        },
      })
      if (overriding.length > 0) {
        console.error(`Warning: ${overriding.join(', ')} is set and takes precedence, so bray will not use this signer until you remove it.`)
      }
      console.log(JSON.stringify({
        paired: true,
        npub: result.npub,
        relays: result.relays,
        saved: true,
      }, null, 2))
      process.exit(0)
    } catch (err) {
      if (err instanceof PairingDeclinedError) {
        console.error('bunker pair: not saved.')
      } else {
        console.error(`bunker pair: ${(err as Error).message}`)
      }
      process.exit(1)
    }
  }

  // ── bunker authorize <app-pubkey> ───────────────────────────────────────────
  // Pre-authorise an app's hex pubkey so it can use the bunker daemon without
  // going through the interactive connect flow.  Reads the saved bunker URI for
  // the bunker transport pubkey (used as the key in approved-clients.json) then
  // writes the new entry — no network connection required.
  if (args[1] === 'authorize') {
    const appPubkey = args[2]
    if (!appPubkey || !/^[0-9a-f]{64}$/i.test(appPubkey)) {
      console.error('usage: bray bunker authorize <64-char-hex-pubkey>')
      process.exit(1)
    }

    const { readStateFile, writeStateFile } = await import('../../state.js')
    const { parseBunkerUri } = await import('../../bunker-context.js')

    // The bunker transport pubkey keys the approvals file.  It is the pubkey
    // encoded in the saved bunker URI (bunker://<pubkey>?…), OR falls back to
    // the BUNKER_URI env var so the command also works without a saved URI.
    const saved = readStateFile<{ uri?: string }>(BUNKER_URI_FILE)
    const bunkerUriStr = saved.uri ?? process.env.BUNKER_URI
    if (!bunkerUriStr) {
      console.error('bunker authorize: no saved bunker URI — run `bunker connect` or `bunker pair` first, or set BUNKER_URI')
      process.exit(1)
    }

    const { pubkey: bunkerPk } = parseBunkerUri(bunkerUriStr)

    const APPROVALS_FILE = 'approved-clients.json'
    const current = readStateFile<Record<string, string[]>>(APPROVALS_FILE)
    const entries = current[bunkerPk] ?? []
    const normalised = appPubkey.toLowerCase()

    if (entries.includes(normalised)) {
      console.error(`bunker authorize: ${normalised} is already authorised`)
      process.exit(0)
    }

    entries.push(normalised)
    current[bunkerPk] = entries
    writeStateFile(APPROVALS_FILE, current)

    console.log(JSON.stringify({ authorised: normalised, total: entries.length }, null, 2))
    process.exit(0)
  }

  // ── bunker status ───────────────────────────────────────────────────────────
  // Report the saved bunker URI and its parsed details.  Does NOT attempt a
  // live connection (use `bunker connect` to verify reachability).
  if (args[1] === 'status') {
    const { readStateFile } = await import('../../state.js')
    const saved = readStateFile<{ uri?: string; paired?: boolean }>(BUNKER_URI_FILE)

    if (!saved.uri) {
      console.log(JSON.stringify({ connected: false }))
      process.exit(0)
    }

    const { parseBunkerUri } = await import('../../bunker-context.js')
    const { npubEncode } = await import('nostr-tools/nip19')

    const cfg = parseBunkerUri(saved.uri)
    const npub = npubEncode(cfg.pubkey)

    console.log(JSON.stringify({
      connected: true,
      npub,
      relays: cfg.relays,
      paired: saved.paired === true,
    }, null, 2))
    process.exit(0)
  }

  // One-shot signing: bray bunker sign <file> [--bunker <url>]
  if (args[1] === 'sign') {
    const { readFileSync } = await import('node:fs')
    const { BunkerContext } = await import('../../bunker-context.js')

    const bunkerUri = process.env.BUNKER_URI
    if (!bunkerUri) {
      console.error('bunker sign: missing bunker URI — use --bunker <url> or set BUNKER_URI')
      process.exit(1)
    }

    const filePath = args[2] && args[2] !== '-' ? args[2] : undefined
    const raw = filePath ? readFileSync(filePath, 'utf-8') : readFileSync(0, 'utf-8')
    const template = JSON.parse(raw) as Record<string, unknown>

    const client = await BunkerContext.connect(bunkerUri)
    await client.resolvePublicKey()

    const sign = client.getSigningFunction()
    const signed = await sign({
      kind: (template.kind as number) ?? 1,
      created_at: (template.created_at as number) ?? Math.floor(Date.now() / 1000),
      tags: (template.tags as string[][]) ?? [],
      content: (template.content as string) ?? '',
    })

    console.log(JSON.stringify(signed, null, 2))
    client.destroy()
    process.exit(0)
  }

  // Bunker daemon
  const { startBunker } = await import('../../bunker.js')
  const { readNsecTreeProfileMnemonic, getOrCreateBunkerKey } = await import('../../bunker-helpers.js')

  // --profile <name>: load the master straight from an nsec-tree-cli profile
  // (~/.nsec-tree/profiles/<name>.json). loadConfig scrubs NOSTR_SECRET_KEY after.
  const profileIdx = args.indexOf('--profile')
  const profileName = profileIdx >= 0 && args[profileIdx + 1] && !args[profileIdx + 1].startsWith('--')
    ? args[profileIdx + 1]
    : undefined
  if (profileName) process.env.NOSTR_SECRET_KEY = readNsecTreeProfileMnemonic(profileName)

  const config = await (await import('../../config.js')).loadConfig()
  const { IdentityContext: IC } = await import('../../context.js')
  const bCtx = new IC(config.secretKey, config.secretFormat)
  ;(config as any).secretKey = ''
  const persona = await applyBunkerPersona(bCtx, args)

  const authorizedKeys = args.includes('--authorized-keys')
    ? args[args.indexOf('--authorized-keys') + 1].split(',')
    : undefined

  let bunkerKeyHex: string | undefined
  if (args.includes('--bunker-key-file')) {
    const { readFileSync } = await import('node:fs')
    bunkerKeyHex = readFileSync(args[args.indexOf('--bunker-key-file') + 1], 'utf-8').trim()
  } else if (args.includes('--bunker-key')) {
    bunkerKeyHex = args[args.indexOf('--bunker-key') + 1]
  } else {
    // No explicit key: persist a STABLE one per identity so the bunker:// URI
    // survives restarts without the operator managing key files.
    bunkerKeyHex = getOrCreateBunkerKey(persona ?? profileName ?? 'default')
  }

  const relays = config.relays.length > 0
    ? config.relays
    : ['wss://relay.damus.io', 'wss://nos.lol']

  const bunker = startBunker({
    ctx: bCtx,
    relays,
    authorizedKeys,
    bunkerKeyHex,
    quiet: args.includes('--quiet'),
  })
  console.error(`nostr-bray bunker running`)
  console.error(`URI: ${bunker.url}`)
  console.error(`Signing as: ${bCtx.activeNpub}`)
  console.error('Press Ctrl+C to stop')
  process.on('SIGINT', () => { bunker.close(); bCtx.destroy(); process.exit(0) })
  process.on('SIGTERM', () => { bunker.close(); bCtx.destroy(); process.exit(0) })
  await new Promise(() => {})
}
