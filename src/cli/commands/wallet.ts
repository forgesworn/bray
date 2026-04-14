import {
  handleZapSend,
  handleZapBalance,
  handleZapListTransactions,
  resolveNwcUri,
  loadWallets,
  saveWallets,
  parseNwcUri,
} from '../../exports.js'
import type { Helpers } from '../dispatch.js'

export interface WalletExtras {
  globalNwcUri: string | undefined
  walletsFile: string
}

/**
 * Dispatch `wallet *` subcommands (NIP-47 Nostr Wallet Connect).
 *
 * Commands:
 *   wallet connect <nwc-url>      Store NWC URI for the active identity
 *   wallet disconnect             Remove the stored NWC URI for the active identity
 *   wallet status                 Show configured wallet pubkey and relay
 *   wallet pay <bolt11>           Pay a Lightning invoice via NWC
 *   wallet balance                Request wallet balance via NWC
 *   wallet history [--limit N]    List recent Lightning transactions via NWC
 */
export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
  extras: WalletExtras,
): Promise<void> {
  const { req, flag, out } = h
  const { globalNwcUri, walletsFile } = extras

  switch (cmd) {
    case 'wallet-connect': {
      const uri = req(1, 'wallet connect <nwc-url>')
      // Validate URI before storing
      parseNwcUri(uri)
      const pubkey = ctx.activePublicKeyHex as string
      const npub = ctx.activeNpub as string
      const wallets = loadWallets(walletsFile)
      wallets[pubkey] = uri
      saveWallets(walletsFile, wallets)
      out({ ok: true, identity: npub, message: `Wallet configured for ${npub}` })
      break
    }

    case 'wallet-disconnect': {
      const pubkey = ctx.activePublicKeyHex as string
      const npub = ctx.activeNpub as string
      const wallets = loadWallets(walletsFile)
      const had = pubkey in wallets
      delete wallets[pubkey]
      saveWallets(walletsFile, wallets)
      out({ ok: true, identity: npub, removed: had, message: had ? `Wallet removed for ${npub}` : `No wallet was set for ${npub}` })
      break
    }

    case 'wallet-status': {
      const npub = ctx.activeNpub as string
      const uri = resolveNwcUri(ctx, walletsFile, globalNwcUri)
      if (!uri) {
        out({ ok: false, identity: npub, configured: false, message: 'No wallet configured. Use `wallet connect <nwc-url>` or set NWC_URI.' })
        break
      }
      const conn = parseNwcUri(uri)
      // Never expose the secret in status output
      out({ ok: true, identity: npub, configured: true, walletPubkey: conn.pubkey, relay: conn.relay })
      break
    }

    case 'wallet-pay':
      out(await handleZapSend(ctx, pool, {
        invoice: req(1, 'wallet pay <bolt11>'),
        nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri),
      }))
      break

    case 'wallet-balance':
      out(await handleZapBalance(ctx, pool, { nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri) }))
      break

    case 'wallet-history':
      out(await handleZapListTransactions(ctx, pool, {
        limit: parseInt(flag('limit', '10')!, 10),
        nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri),
      }))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
