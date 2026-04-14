import {
  handleDecode, handleEncodeNpub, handleEncodeNote, handleEncodeNprofile,
  handleEncodeNevent, handleVerify, handleEncrypt, handleDecrypt,
  handleCount, handleFetch, handleKeyPublic, handleEncodeNsec,
  handleFilter, handleNipList, handleNipShow,
  handleKeyEncrypt, handleKeyDecrypt,
} from '../../exports.js'
import * as fmt from '../../format.js'
import type { Helpers } from '../dispatch.js'

export async function dispatch(
  cmd: string,
  cmdArgs: string[],
  h: Helpers,
  ctx: any,
  pool: any,
): Promise<void> {
  const { req, flag, out } = h

  switch (cmd) {
    case 'decode':
      out(handleDecode(req(1, 'decode <nip19>')), fmt.formatDecode)
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

    case 'encode-nsec':
      console.log(handleEncodeNsec(req(1, 'encode-nsec <hex>')))
      break

    case 'key-public':
      out(handleKeyPublic(req(1, 'key-public <nsec-or-hex>')))
      break

    case 'key-encrypt':
      out(handleKeyEncrypt(
        req(1, 'key-encrypt <nsec-or-hex> <password>'),
        req(2, 'key-encrypt <nsec-or-hex> <password>'),
      ))
      break

    case 'key-decrypt':
      out(handleKeyDecrypt(
        req(1, 'key-decrypt <ncryptsec> <password>'),
        req(2, 'key-decrypt <ncryptsec> <password>'),
      ))
      break

    case 'filter':
      out(handleFilter(
        JSON.parse(req(1, 'filter <event-json> <filter-json>')),
        JSON.parse(req(2, 'filter <event-json> <filter-json>')),
      ))
      break

    case 'nips':
      out(await handleNipList(), fmt.formatNipList)
      break

    case 'nip': {
      const num = parseInt(req(1, 'nip <number>'), 10)
      const nip = await handleNipShow(num)
      console.log(nip.content)
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
      throw new Error(`Unknown command: ${cmd}. Run --help for usage.`)
  }
}
