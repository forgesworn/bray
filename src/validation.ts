import { z } from 'zod'

/** 64-character lowercase hex string (pubkey or event ID) */
export const hexId = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex string')

/** Relay WebSocket URL — wss:// or ws:// only */
export const relayUrl = z.string().regex(/^wss?:\/\//, 'Must be a wss:// or ws:// URL')
