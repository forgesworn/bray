/**
 * Mock NWC Wallet Service
 *
 * An in-process NIP-47 wallet that:
 * 1. Receives kind 23194 request events
 * 2. Decrypts them using NIP-44
 * 3. Processes the method (pay_invoice, get_balance, etc.)
 * 4. Encrypts and returns a kind 23195 response
 *
 * No real Lightning — just validates the full crypto round-trip.
 */

import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools'

export interface MockWallet {
  /** Wallet's secret key (hex) */
  secretKeyHex: string
  /** Wallet's public key (hex) */
  pubkey: string
  /** Process a NWC request event and return a response event */
  processRequest(requestEvent: NostrEvent): NostrEvent
  /** Simulated balance in msats */
  balance: number
  /** History of processed methods */
  history: Array<{ method: string; params: Record<string, unknown> }>
}

export function createMockWallet(opts?: { balance?: number }): MockWallet {
  const walletSk = generateSecretKey()
  const walletSkHex = Buffer.from(walletSk).toString('hex')
  const walletPubkey = getPublicKey(walletSk)
  let balance = opts?.balance ?? 1_000_000 // 1M msats = 1000 sats default
  const history: MockWallet['history'] = []

  function processRequest(requestEvent: NostrEvent): NostrEvent {
    // The request is from the NWC client — decrypt using wallet's sk + client's pubkey
    const clientPubkey = requestEvent.pubkey
    const conversationKey = getConversationKey(walletSk, clientPubkey)
    const plaintext = decrypt(requestEvent.content, conversationKey)
    const { method, params } = JSON.parse(plaintext)

    history.push({ method, params })

    // Process the method
    let responsePayload: Record<string, unknown>

    switch (method) {
      case 'pay_invoice':
        if (balance < 10000) {
          responsePayload = {
            result_type: 'pay_invoice',
            error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough funds' },
          }
        } else {
          balance -= 10000 // deduct a fixed 10 sats for test
          responsePayload = {
            result_type: 'pay_invoice',
            result: {
              preimage: 'a'.repeat(64),
              fees_paid: 1000, // 1 sat fee
            },
          }
        }
        break

      case 'get_balance':
        responsePayload = {
          result_type: 'get_balance',
          result: { balance },
        }
        break

      case 'make_invoice':
        responsePayload = {
          result_type: 'make_invoice',
          result: {
            invoice: 'lnbc' + (params.amount ?? 0) + 'n1mock',
            payment_hash: 'b'.repeat(64),
          },
        }
        break

      case 'lookup_invoice':
        responsePayload = {
          result_type: 'lookup_invoice',
          result: {
            invoice: params.invoice ?? 'lnbc1mock',
            paid: true,
            preimage: 'c'.repeat(64),
          },
        }
        break

      case 'list_transactions':
        responsePayload = {
          result_type: 'list_transactions',
          result: {
            transactions: [
              { type: 'incoming', amount: 50000, description: 'test payment', settled_at: 1000 },
            ],
          },
        }
        break

      default:
        responsePayload = {
          result_type: method,
          error: { code: 'NOT_IMPLEMENTED', message: `Method ${method} not supported` },
        }
    }

    // Encrypt the response back to the client
    const responseContent = encrypt(JSON.stringify(responsePayload), conversationKey)

    const responseEvent = finalizeEvent({
      kind: 23195,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', clientPubkey],
        ['e', requestEvent.id],
      ],
      content: responseContent,
    }, walletSk) as unknown as NostrEvent

    return responseEvent
  }

  return {
    secretKeyHex: walletSkHex,
    pubkey: walletPubkey,
    processRequest,
    get balance() { return balance },
    history,
  }
}

/** Build a NWC URI for connecting to a mock wallet */
export function buildNwcUri(walletPubkey: string, clientSecret: string, relay: string = 'wss://mock.relay'): string {
  return `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(relay)}&secret=${clientSecret}`
}
