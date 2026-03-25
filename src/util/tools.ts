import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { hexId } from '../validation.js'
import { handleKeyEncrypt, handleKeyDecrypt } from './ncryptsec.js'
import {
  handleDecode,
  handleEncodeNpub,
  handleEncodeNote,
  handleEncodeNprofile,
  handleEncodeNevent,
  handleEncodeNaddr,
  handleVerify,
  handleEncrypt,
  handleDecrypt,
  handleCount,
  handleFetch,
  handleKeyPublic,
  handleEncodeNsec,
  handleFilter,
  handleNipList,
  handleNipShow,
} from './handlers.js'

export function registerUtilTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool('decode', {
    description: 'Decode a nip19 entity (npub, nsec, note, nevent, nprofile, naddr) or nostr: URI to its components.',
    inputSchema: {
      input: z.string().describe('nip19 string or nostr: URI to decode'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ input }) => {
    const result = handleDecode(input)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('encode-npub', {
    description: 'Encode a hex public key as a bech32 npub.',
    inputSchema: { hex: hexId.describe('Hex public key') },
    annotations: { readOnlyHint: true },
  }, async ({ hex }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNpub(hex) }] }
  })

  server.registerTool('encode-note', {
    description: 'Encode a hex event ID as a bech32 note.',
    inputSchema: { hex: hexId.describe('Hex event ID') },
    annotations: { readOnlyHint: true },
  }, async ({ hex }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNote(hex) }] }
  })

  server.registerTool('encode-nprofile', {
    description: 'Encode a hex pubkey with relay hints as a bech32 nprofile.',
    inputSchema: {
      pubkey: hexId.describe('Hex public key'),
      relays: z.array(z.string()).optional().describe('Relay URL hints'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, relays }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNprofile(pubkey, relays) }] }
  })

  server.registerTool('encode-nevent', {
    description: 'Encode an event ID with relay hints and optional author as a bech32 nevent.',
    inputSchema: {
      id: hexId.describe('Hex event ID'),
      relays: z.array(z.string()).optional().describe('Relay URL hints'),
      author: hexId.optional().describe('Author hex pubkey'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ id, relays, author }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNevent(id, relays, author) }] }
  })

  server.registerTool('encode-naddr', {
    description: 'Encode an addressable event reference as a bech32 naddr.',
    inputSchema: {
      pubkey: hexId.describe('Author hex pubkey'),
      kind: z.number().int().describe('Event kind'),
      identifier: z.string().describe('d-tag value'),
      relays: z.array(z.string()).optional().describe('Relay URL hints'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ pubkey, kind, identifier, relays }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNaddr(pubkey, kind, identifier, relays) }] }
  })

  server.registerTool('verify-event', {
    description: 'Verify a Nostr event\'s id hash and cryptographic signature.',
    inputSchema: {
      event: z.record(z.string(), z.unknown()).describe('The Nostr event object to verify'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ event }) => {
    const result = handleVerify(event as any)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('nip44-encrypt', {
    description: 'Encrypt a plaintext string using NIP-44 for a recipient pubkey. Uses the active identity\'s private key.',
    inputSchema: {
      recipientPubkeyHex: hexId.describe('Recipient hex pubkey'),
      plaintext: z.string().describe('Text to encrypt'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ recipientPubkeyHex, plaintext }) => {
    const skHex = Buffer.from(deps.ctx.activePrivateKey).toString('hex')
    const ciphertext = handleEncrypt(skHex, recipientPubkeyHex, plaintext)
    return { content: [{ type: 'text' as const, text: ciphertext }] }
  })

  server.registerTool('nip44-decrypt', {
    description: 'Decrypt a NIP-44 ciphertext using the active identity\'s private key.',
    inputSchema: {
      senderPubkeyHex: hexId.describe('Sender hex pubkey'),
      ciphertext: z.string().describe('NIP-44 ciphertext to decrypt'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ senderPubkeyHex, ciphertext }) => {
    const skHex = Buffer.from(deps.ctx.activePrivateKey).toString('hex')
    const plaintext = handleDecrypt(skHex, senderPubkeyHex, ciphertext)
    return { content: [{ type: 'text' as const, text: plaintext }] }
  })

  server.registerTool('count', {
    description: 'Count events matching a filter on the active identity\'s relays.',
    inputSchema: {
      kinds: z.array(z.number().int()).optional().describe('Event kinds to count'),
      authors: z.array(hexId).optional().describe('Author hex pubkeys'),
      since: z.number().optional().describe('Unix timestamp lower bound'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ kinds, authors, since }) => {
    const filter: Record<string, unknown> = {}
    if (kinds) filter.kinds = kinds
    if (authors) filter.authors = authors
    if (since) filter.since = since
    const result = await handleCount(deps.pool, deps.ctx.activeNpub, filter as any)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('fetch', {
    description: 'Fetch events by nip19 code (note, nevent, nprofile, npub, naddr). Resolves the entity and queries relays.',
    inputSchema: {
      code: z.string().describe('nip19 code or nostr: URI'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ code }) => {
    const events = await handleFetch(deps.pool, deps.ctx.activeNpub, code)
    return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] }
  })

  server.registerTool('key-public', {
    description: 'Derive a public key (hex + npub) from a secret key (nsec or hex). WARNING: the secret key is transmitted through the MCP transport — use only for local/trusted setups.',
    inputSchema: {
      secret: z.string().describe('Secret key as nsec or hex'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret }) => {
    const result = handleKeyPublic(secret)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('encode-nsec', {
    description: 'Encode a hex private key as a bech32 nsec. WARNING: private key material flows through the MCP transport.',
    inputSchema: { hex: z.string().regex(/^[0-9a-f]{64}$/).describe('Hex private key') },
    annotations: { readOnlyHint: true },
  }, async ({ hex }) => {
    return { content: [{ type: 'text' as const, text: handleEncodeNsec(hex) }] }
  })

  server.registerTool('filter', {
    description: 'Test if a Nostr event matches a given filter. Returns true or false.',
    inputSchema: {
      event: z.record(z.string(), z.unknown()).describe('Nostr event object'),
      filter: z.record(z.string(), z.unknown()).describe('Nostr filter object'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ event, filter }) => {
    const result = handleFilter(event as any, filter as any)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('nip-list', {
    description: 'List all official Nostr NIPs from the protocol repository.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const nips = await handleNipList()
    return { content: [{ type: 'text' as const, text: JSON.stringify(nips, null, 2) }] }
  })

  server.registerTool('nip-show', {
    description: 'Fetch and display the full content of an official NIP by number.',
    inputSchema: {
      number: z.number().int().min(1).describe('NIP number (e.g. 1, 17, 65)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ number }) => {
    const nip = await handleNipShow(number)
    return { content: [{ type: 'text' as const, text: nip.content }] }
  })

  server.registerTool('key-encrypt', {
    description: 'Encrypt a secret key with a password (NIP-49 ncryptsec). Returns the ncryptsec string and the derived pubkey. WARNING: secret key is transmitted through the MCP transport.',
    inputSchema: {
      secret: z.string().describe('Secret key (nsec or hex)'),
      password: z.string().describe('Password to encrypt with'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ secret, password }) => {
    const result = handleKeyEncrypt(secret, password)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })

  server.registerTool('key-decrypt', {
    description: 'Decrypt an ncryptsec (NIP-49) with a password. Returns the derived pubkey for verification — never the raw key.',
    inputSchema: {
      ncryptsec: z.string().describe('ncryptsec string to decrypt'),
      password: z.string().describe('Password used during encryption'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ ncryptsec, password }) => {
    const result = handleKeyDecrypt(ncryptsec, password)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  })
}
