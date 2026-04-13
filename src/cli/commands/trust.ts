import { handleTrustAttest, handleTrustRead, handleTrustVerify, handleTrustRevoke, handleTrustRequest, handleTrustRequestList } from '../../trust/handlers.js'
import { handleTrustRingProve, handleTrustRingVerify } from '../../trust/ring.js'
import { handleTrustSpokenChallenge, handleTrustSpokenVerify } from '../../trust/spoken.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { req, flag, flags, out } = h

  switch (cmd) {
    case 'attest': {
      const assertionId = req(1, 'attest <assertion-event-id> [--subject <hex>] [--type <type>] [--summary <text>]')
      out(await handleTrustAttest(ctx, pool, {
        assertionId,
        subject: flag('subject'),
        type: flag('type'),
        summary: flag('summary'),
        assertionRelay: flag('assertion-relay'),
        relays: flags('relay'),
      }))
      break
    }

    case 'claim': {
      const type = req(1, 'claim <type> [--subject <hex>] [--identifier <string>] [--summary <text>] [--assertion-address kind:pubkey:d-tag]')
      out(await handleTrustAttest(ctx, pool, {
        type,
        subject: flag('subject'),
        identifier: flag('identifier'),
        summary: flag('summary'),
        assertionAddress: flag('assertion-address'),
        assertionRelay: flag('assertion-relay'),
        relays: flags('relay'),
      }))
      break
    }

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

    default:
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
