#!/usr/bin/env node
/**
 * Minimal NWC-to-phoenixd bridge
 *
 * Listens for NIP-47 (kind 23194) wallet requests on a relay,
 * proxies them to a phoenixd HTTP API, and publishes responses (kind 23195).
 *
 * Usage:
 *   PHOENIXD_URL=http://localhost:9741 \
 *   PHOENIXD_PASSWORD=<password> \
 *   RELAY=wss://relay.damus.io \
 *   node nwc-bridge.mjs
 *
 * Prints the nostr+walletconnect:// URI on startup.
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { Relay } from 'nostr-tools/relay'
function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}
function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

const PHOENIXD_URL = process.env.PHOENIXD_URL || 'http://localhost:9741'
const PHOENIXD_PASSWORD = process.env.PHOENIXD_PASSWORD
const RELAY_URL = process.env.RELAY || 'wss://relay.damus.io'

if (!PHOENIXD_PASSWORD) {
  console.error('PHOENIXD_PASSWORD is required')
  process.exit(1)
}

// Generate bridge keypair (the "wallet service" identity)
const bridgeSecret = process.env.BRIDGE_SECRET
  ? hexToBytes(process.env.BRIDGE_SECRET)
  : generateSecretKey()
const bridgePubkey = getPublicKey(bridgeSecret)

// Generate client secret (shared with the NWC URI holder)
const clientSecret = process.env.CLIENT_SECRET
  ? hexToBytes(process.env.CLIENT_SECRET)
  : generateSecretKey()
const clientPubkey = getPublicKey(clientSecret)

const nwcUri = `nostr+walletconnect://${bridgePubkey}?relay=${encodeURIComponent(RELAY_URL)}&secret=${bytesToHex(clientSecret)}`
console.log('\nNWC URI:')
console.log(nwcUri)
console.log(`\nBridge pubkey: ${bridgePubkey}`)
console.log(`Client pubkey: ${clientPubkey}`)
console.log(`Relay: ${RELAY_URL}`)
console.log(`Phoenixd: ${PHOENIXD_URL}\n`)

// Save secrets for restart persistence
if (!process.env.BRIDGE_SECRET) {
  console.log(`BRIDGE_SECRET=${bytesToHex(bridgeSecret)}`)
  console.log(`CLIENT_SECRET=${bytesToHex(clientSecret)}`)
  console.log('')
}

// --- Phoenixd API ---

async function phoenixd(method, path, body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${Buffer.from(':' + PHOENIXD_PASSWORD).toString('base64')}`,
    },
  }
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    opts.body = new URLSearchParams(body).toString()
  }
  const res = await fetch(`${PHOENIXD_URL}${path}`, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`phoenixd ${path}: ${res.status} ${text}`)
  }
  return res.json()
}

async function handleNwcMethod(method, params) {
  switch (method) {
    case 'get_balance': {
      const bal = await phoenixd('GET', '/getbalance')
      const totalSat = (bal.balanceSat || 0) + (bal.feeCreditSat || 0)
      return { balance: totalSat * 1000 } // msats
    }

    case 'pay_invoice': {
      const result = await phoenixd('POST', '/payinvoice', {
        invoice: params.invoice,
      })
      return {
        preimage: result.paymentPreimage || result.preimage || '',
      }
    }

    case 'make_invoice': {
      const result = await phoenixd('POST', '/createinvoice', {
        amountSat: Math.ceil((params.amount || 0) / 1000),
        description: params.description || 'NWC invoice',
      })
      return {
        type: 'incoming',
        invoice: result.serialized || result.invoice,
        payment_hash: result.paymentHash,
        amount: params.amount,
        description: params.description,
      }
    }

    case 'lookup_invoice': {
      const payments = await phoenixd('GET', '/payments/incoming')
      const match = payments.find(p =>
        (params.payment_hash && p.paymentHash === params.payment_hash) ||
        (params.invoice && p.invoice === params.invoice)
      )
      if (!match) throw new Error('Invoice not found')
      return {
        type: 'incoming',
        invoice: match.invoice,
        payment_hash: match.paymentHash,
        amount: (match.receivedSat || 0) * 1000,
        settled_at: match.completedAt ? Math.floor(match.completedAt / 1000) : undefined,
        preimage: match.preimage || '',
      }
    }

    case 'list_transactions': {
      const payments = await phoenixd('GET', '/payments/incoming')
      const limit = params.limit || 10
      const offset = params.offset || 0
      const txns = payments.slice(offset, offset + limit).map(p => ({
        type: 'incoming',
        invoice: p.invoice,
        payment_hash: p.paymentHash,
        amount: (p.receivedSat || 0) * 1000,
        settled_at: p.completedAt ? Math.floor(p.completedAt / 1000) : undefined,
        preimage: p.preimage || '',
      }))
      return { transactions: txns }
    }

    default:
      throw new Error(`Unsupported method: ${method}`)
  }
}

// --- NWC Protocol ---

function decryptRequest(event) {
  // Client encrypts with their secret to our pubkey
  const conversationKey = getConversationKey(bridgeSecret, event.pubkey)
  const plaintext = decrypt(event.content, conversationKey)
  return JSON.parse(plaintext)
}

function buildResponse(requestEvent, resultType, result, error) {
  const conversationKey = getConversationKey(bridgeSecret, requestEvent.pubkey)
  const payload = { result_type: resultType }
  if (error) {
    payload.error = { code: 'OTHER', message: error }
  } else {
    payload.result = result
  }
  const content = encrypt(JSON.stringify(payload), conversationKey)
  return finalizeEvent({
    kind: 23195,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', requestEvent.pubkey],
      ['e', requestEvent.id],
    ],
    content,
  }, bridgeSecret)
}

// --- Main ---

async function main() {
  const relay = await Relay.connect(RELAY_URL)
  console.log(`Connected to ${RELAY_URL}`)

  const sub = relay.subscribe([
    {
      kinds: [23194],
      '#p': [bridgePubkey],
      since: Math.floor(Date.now() / 1000) - 10,
    },
  ], {
    onevent: async (event) => {
      try {
        const request = decryptRequest(event)
        console.log(`NWC request: ${request.method}`)

        const result = await handleNwcMethod(request.method, request.params || {})
        const response = buildResponse(event, request.method, result)
        await relay.publish(response)
        console.log(`  -> response published`)
      } catch (err) {
        console.error(`  -> error: ${err.message}`)
        try {
          const request = decryptRequest(event)
          const response = buildResponse(event, request.method, null, err.message)
          await relay.publish(response)
        } catch { /* ignore double-error */ }
      }
    },
  })

  console.log('Listening for NWC requests...\n')

  // Keep alive
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    sub.close()
    relay.close()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
