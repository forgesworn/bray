import { npubEncode } from 'nostr-tools/nip19'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SigningContext } from './signing-context.js'
import type { PublicIdentity, SignFn } from './types.js'

/** The one message every refused operation returns, so agents learn a single fix. */
export const READ_ONLY_MESSAGE =
  'bray is read-only: no key or bunker is configured, so it cannot sign, encrypt, decrypt or pay. ' +
  'Set BUNKER_URI (a NIP-46 signer) to enable signing.'

const NO_PUBKEY_MESSAGE =
  'bray is read-only and has no identity: set NOSTR_PUBKEY (an npub) to read from that account\'s perspective.'

/**
 * Signing context for read-only mode. It holds no secret, so nothing reached
 * through it can sign, encrypt, decrypt or derive. This, not the tool filter,
 * is what makes read-only mode safe: a tool that is mislabelled or added later
 * still fails here.
 */
export class ReadOnlyContext implements SigningContext {
  readonly readOnly = true
  readonly #pubkeyHex: string | undefined
  readonly #npub: string

  constructor(pubkeyHex?: string) {
    this.#pubkeyHex = pubkeyHex
    this.#npub = pubkeyHex ? npubEncode(pubkeyHex) : ''
  }

  /**
   * The npub, or '' without NOSTR_PUBKEY. Most tools use this only to choose
   * relays, and the relay pool falls back to the default relays for an npub
   * it does not know, so '' keeps generic lookups working.
   */
  get activeNpub(): string {
    return this.#npub
  }

  /** Throws without NOSTR_PUBKEY, so "my feed" style queries fail clearly. */
  get activePublicKeyHex(): string {
    if (!this.#pubkeyHex) throw new Error(NO_PUBKEY_MESSAGE)
    return this.#pubkeyHex
  }

  get hasIdentity(): boolean {
    return this.#pubkeyHex !== undefined
  }

  getSigningFunction(): SignFn {
    throw new Error(READ_ONLY_MESSAGE)
  }

  async listIdentities(): Promise<PublicIdentity[]> {
    return this.#pubkeyHex ? [{ npub: this.#npub }] : []
  }

  async nip44Encrypt(): Promise<string> {
    throw new Error(READ_ONLY_MESSAGE)
  }

  async nip44Decrypt(): Promise<string> {
    throw new Error(READ_ONLY_MESSAGE)
  }

  destroy(): void {
    // Nothing secret to clear.
  }
}

export function isReadOnlyContext(ctx: SigningContext): ctx is ReadOnlyContext {
  return ctx instanceof ReadOnlyContext
}

/**
 * Tools marked readOnlyHint that still have no place in read-only mode: they
 * need the private key, handle secret material passed in by the caller, read
 * a wallet, read state only a keyed server creates, or send arbitrary HTTP
 * requests. The context would refuse most of them anyway; leaving them out
 * keeps the tool list honest.
 */
export const READ_ONLY_EXCLUDED: ReadonlySet<string> = new Set([
  // Private key or derived identities
  'identity-list', 'identity-prove', 'identity-backup', 'identity-restore-shamir',
  'trust-ring-key-image',
  // Decryption and encryption as the active identity
  'dm-read', 'dm-conversation', 'gift-wrap', 'gift-unwrap', 'nip44-encrypt', 'nip44-decrypt',
  'vault-encrypt', 'vault-read', 'vault-read-shared', 'vault-members', 'vault-config',
  // Secret keys passed through the MCP transport
  'key-public', 'encode-nsec', 'key-encrypt', 'key-decrypt',
  // Wallets
  'zap-balance', 'zap-lookup-invoice', 'zap-list-transactions', 'wallet-grants',
  // Local state written by a keyed server
  'post-queue-list',
  'canary-session-current', 'canary-session-verify', 'canary-group-current', 'canary-group-verify',
  'canary-group-members', 'canary-beacon-check', 'canary-duress-detect',
  // Arbitrary HTTP methods, including POST, PUT and DELETE
  'marketplace-probe',
])

/** Whether a tool is offered in read-only mode. */
export function isReadOnlyTool(name: string, definition: { annotations?: { readOnlyHint?: boolean } } | undefined): boolean {
  return definition?.annotations?.readOnlyHint === true && !READ_ONLY_EXCLUDED.has(name)
}

/**
 * Wrap a server (or the catalog proxy) so only read-only tools register.
 * Registration-time filtering covers both promoted tools and the catalog that
 * execute-action draws from. `dropped` collects the names left out.
 */
export function createReadOnlyFilter(
  server: McpServer,
  dropped: string[],
  options: { hasIdentity?: boolean } = {},
): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'registerTool') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (name: string, definition: any, handler: any) => {
          if (!isReadOnlyTool(name, definition)) {
            dropped.push(name)
            return undefined
          }
          // Without NOSTR_PUBKEY, tools about "your" account fail deep in a
          // handler with a decoding error. Say what is missing instead.
          const wrapped = options.hasIdentity
            ? handler
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : async (...args: any[]) => {
              try {
                return await handler(...args)
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                throw new Error(
                  `${message}. If this tool reads your own account, note that bray is read-only with no identity: set NOSTR_PUBKEY to an npub.`,
                  { cause: err },
                )
              }
            }
          return Reflect.get(target, prop, receiver).call(target, name, definition, wrapped)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
