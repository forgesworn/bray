import { handleZapSend, handleZapBalance, handleZapMakeInvoice, handleZapLookupInvoice, handleZapListTransactions, handleZapReceipts, handleZapDecode, resolveNwcUri } from '../../zap/handlers.js'
import * as fmt from '../../format.js'
import type { Helpers } from '../dispatch.js'

export interface ZapExtras {
  globalNwcUri: string | undefined
  walletsFile: string
}

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
  extras: ZapExtras,
): Promise<void> {
  const { req, flag, out } = h
  const { globalNwcUri, walletsFile } = extras

  switch (cmd) {
    case 'zap-send':
      out(await handleZapSend(ctx, pool, { invoice: req(1, 'zap-send <bolt11>'), nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri) }))
      break

    case 'zap-balance':
      out(await handleZapBalance(ctx, pool, { nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri) }))
      break

    case 'zap-invoice':
      out(await handleZapMakeInvoice(ctx, pool, {
        amountMsats: parseInt(req(1, 'zap-invoice <msats> [description]'), 10),
        description: cmdArgs[2],
        nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri),
      }))
      break

    case 'zap-lookup':
      out(await handleZapLookupInvoice(ctx, pool, { paymentHash: req(1, 'zap-lookup <payment-hash>'), nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri) }))
      break

    case 'zap-transactions':
      out(await handleZapListTransactions(ctx, pool, {
        limit: parseInt(flag('limit', '10')!, 10),
        nwcUri: resolveNwcUri(ctx, walletsFile, globalNwcUri),
      }))
      break

    case 'zap-receipts':
      out(await handleZapReceipts(ctx, pool, { limit: parseInt(flag('limit', '20')!, 10) }), fmt.formatZapReceipts)
      break

    case 'zap-decode':
      out(handleZapDecode(req(1, 'zap-decode <bolt11>')))
      break

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
