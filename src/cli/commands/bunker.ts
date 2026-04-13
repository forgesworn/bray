/**
 * Bunker command module.
 * Both bunker sign and bunker daemon are dispatched BEFORE ctx/pool setup in index.ts,
 * so this module does its own config/context construction.
 */

export async function dispatch(args: string[]): Promise<void> {
  // Accept `bunker daemon` as alias for `bunker` (start daemon)
  if (args[1] === 'daemon') args.splice(1, 1)

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
