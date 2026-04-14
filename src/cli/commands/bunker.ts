/**
 * Bunker command module.
 * bunker sign, bunker connect, bunker authorize, bunker status, and bunker daemon
 * are all dispatched BEFORE ctx/pool setup in index.ts, so this module does its
 * own config/context construction.
 */

/** Filename used to persist the active bunker URI inside the bray state dir. */
const BUNKER_URI_FILE = 'bunker-uri'

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
      console.error('bunker authorize: no saved bunker URI — run `bunker connect` first or set BUNKER_URI')
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
    const saved = readStateFile<{ uri?: string }>(BUNKER_URI_FILE)

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
  const config = await (await import('../../config.js')).loadConfig()
  const { IdentityContext: IC } = await import('../../context.js')
  const bCtx = new IC(config.secretKey, config.secretFormat)
  ;(config as any).secretKey = ''
  const authorizedKeys = args.includes('--authorized-keys')
    ? args[args.indexOf('--authorized-keys') + 1].split(',')
    : undefined
  let bunkerKeyHex: string | undefined
  if (args.includes('--bunker-key-file')) {
    const { readFileSync } = await import('node:fs')
    bunkerKeyHex = readFileSync(args[args.indexOf('--bunker-key-file') + 1], 'utf-8').trim()
  } else if (args.includes('--bunker-key')) {
    bunkerKeyHex = args[args.indexOf('--bunker-key') + 1]
  }

  const bunker = startBunker({
    ctx: bCtx,
    relays: config.relays,
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
