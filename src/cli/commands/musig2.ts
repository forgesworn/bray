import {
  handleMusig2Key,
  handleMusig2Nonce,
  handleMusig2PartialSign,
  handleMusig2Aggregate,
} from '../../exports.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  _cmdArgs: string[],
  h: Helpers,
): Promise<void> {
  const { flag, out } = h

  switch (cmd) {
    case 'musig2-key': {
      out(handleMusig2Key())
      break
    }

    case 'musig2-nonce': {
      const secKey = flag('--sk') ?? flag('--sec-key')
      if (!secKey) throw new Error('musig2 nonce requires --sk <hex-private-key>')
      const aggpk = flag('--aggpk') ?? undefined
      const msg = flag('--msg') ?? flag('--message') ?? undefined
      const extra = flag('--extra') ?? undefined
      // nonceId is one-shot: pass it to partial-sign exactly once.
      out(handleMusig2Nonce(secKey, { aggpk, msg, extra }))
      break
    }

    case 'musig2-partial-sign': {
      const secKey = flag('--sk') ?? flag('--sec-key')
      const nonceId = flag('--nonce-id')
      const pubNoncesRaw = flag('--pub-nonces')
      const pubKeysRaw = flag('--pub-keys')
      const msg = flag('--msg') ?? flag('--message')
      if (!secKey) throw new Error('musig2 partial-sign requires --sk <hex>')
      if (!nonceId) throw new Error('musig2 partial-sign requires --nonce-id <hex> (from musig2 nonce)')
      if (!pubNoncesRaw) throw new Error('musig2 partial-sign requires --pub-nonces <hex,hex,...>')
      if (!pubKeysRaw) throw new Error('musig2 partial-sign requires --pub-keys <hex,hex,...>')
      if (!msg) throw new Error('musig2 partial-sign requires --msg <32-byte-hex>')
      const pubNonces = pubNoncesRaw.split(',').map(s => s.trim())
      const pubKeys = pubKeysRaw.split(',').map(s => s.trim())
      out(handleMusig2PartialSign(secKey, nonceId, pubNonces, pubKeys, msg))
      break
    }

    case 'musig2-aggregate': {
      const partialSigsRaw = flag('--partial-sigs')
      const pubNoncesRaw = flag('--pub-nonces')
      const pubKeysRaw = flag('--pub-keys')
      const msg = flag('--msg') ?? flag('--message')
      if (!partialSigsRaw) throw new Error('musig2 aggregate requires --partial-sigs <hex,hex,...>')
      if (!pubNoncesRaw) throw new Error('musig2 aggregate requires --pub-nonces <hex,hex,...>')
      if (!pubKeysRaw) throw new Error('musig2 aggregate requires --pub-keys <hex,hex,...>')
      if (!msg) throw new Error('musig2 aggregate requires --msg <32-byte-hex>')
      const partialSigs = partialSigsRaw.split(',').map(s => s.trim())
      const pubNonces = pubNoncesRaw.split(',').map(s => s.trim())
      const pubKeys = pubKeysRaw.split(',').map(s => s.trim())
      out(handleMusig2Aggregate(partialSigs, pubNonces, pubKeys, msg))
      break
    }

    default:
      throw new Error(`Unknown musig2 subcommand: ${cmd}`)
  }
}
