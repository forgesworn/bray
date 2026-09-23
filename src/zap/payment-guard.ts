import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { withFileLock } from '../file-lock.js'

// bray's own ceiling on what it will spend, whichever wallet is behind it.
//
// An NWC URI is an unbounded capability, and an MCP `confirm: true` is a
// boolean the model sets for itself. Neither is a limit. This is: a
// per-payment maximum and a rolling 24-hour total, read from the
// environment, checked before any payment is attempted and written to disk
// so a restart does not hand back the day's allowance.
//
// It is still bray policing itself. The limit bray cannot talk its way
// past is a budget set in the wallet on the connection bray holds.

/** 5,000 sats. */
export const DEFAULT_MAX_PAYMENT_MSAT = 5_000_000
/** 20,000 sats in any rolling 24 hours. */
export const DEFAULT_MAX_DAILY_MSAT = 20_000_000

const DAY_MS = 86_400_000
const KEEP_SETTLED_MS = 7 * DAY_MS
const MAX_ENTRIES = 4096
const MAX_FILE_BYTES = 4 * 1_048_576

/**
 * Routing fees are unknown until a payment lands, so a payment reserves a
 * margin for them: 1% of the amount, never less than 1 sat. The actual fee
 * replaces the margin once the wallet reports it.
 */
export function feeReserveMsat(amountMsat: number): number {
  return Math.max(1_000, Math.ceil(amountMsat / 100))
}

export interface PaymentLimits {
  maxPaymentMsat: number
  maxDailyMsat: number
}

function positiveMsat(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number of millisatoshis`)
  }
  return value
}

/** Read `BRAY_MAX_PAYMENT_MSAT` and `BRAY_MAX_DAILY_MSAT`, falling back to the defaults. */
export function paymentLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentLimits {
  return {
    maxPaymentMsat: positiveMsat(env.BRAY_MAX_PAYMENT_MSAT, 'BRAY_MAX_PAYMENT_MSAT', DEFAULT_MAX_PAYMENT_MSAT),
    maxDailyMsat: positiveMsat(env.BRAY_MAX_DAILY_MSAT, 'BRAY_MAX_DAILY_MSAT', DEFAULT_MAX_DAILY_MSAT),
  }
}

/** bray's state directory: `BRAY_HOME`, else `$XDG_CONFIG_HOME/bray`, else `~/.config/bray`. */
export function brayStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAY_HOME ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'bray')
}

export function defaultLedgerPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(brayStateDir(env), 'payment-ledger.json')
}

/** A payment bray refused before anything was sent. */
export class PaymentLimitError extends Error {
  readonly code = 'PAYMENT_LIMIT'
  constructor(message: string) {
    super(message)
    this.name = 'PaymentLimitError'
  }
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'unknown'

interface LedgerEntry {
  /** What this payment counts against the daily total right now. */
  chargedMsat: number
  amountMsat: number
  status: PaymentStatus
  at: number
}

interface LedgerFile {
  version: 1
  payments: Record<string, LedgerEntry>
}

export interface PaymentGuardOptions {
  path?: string
  limits?: PaymentLimits
  now?: () => number
}

export class PaymentGuard {
  readonly path: string
  readonly limits: PaymentLimits
  readonly #now: () => number

  constructor(options: PaymentGuardOptions = {}) {
    this.path = options.path ?? defaultLedgerPath()
    this.limits = options.limits ?? paymentLimitsFromEnv()
    this.#now = options.now ?? (() => Date.now())
  }

  #read(): LedgerFile {
    if (!existsSync(this.path)) return { version: 1, payments: {} }
    const raw = readFileSync(this.path, 'utf8')
    if (raw.length > MAX_FILE_BYTES) throw new Error('The payment ledger is implausibly large; refusing to spend.')
    let parsed: LedgerFile
    try {
      parsed = JSON.parse(raw) as LedgerFile
    } catch {
      // Failing closed: a ledger nobody can read is not evidence that
      // nothing has been spent today.
      throw new Error(`The payment ledger at ${this.path} is not readable JSON; refusing to spend until it is fixed.`)
    }
    if (parsed?.version !== 1 || typeof parsed.payments !== 'object' || parsed.payments === null) {
      throw new Error(`The payment ledger at ${this.path} has an unsupported format; refusing to spend.`)
    }
    return parsed
  }

  #write(file: LedgerFile): void {
    const now = this.#now()
    const entries = Object.entries(file.payments)
      .filter(([, entry]) =>
        entry.status === 'pending' || entry.status === 'unknown' || now - entry.at < KEEP_SETTLED_MS)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, MAX_ENTRIES)
    const pruned: LedgerFile = { version: 1, payments: Object.fromEntries(entries) }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(pruned, null, 2), { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, this.path)
  }

  #mutate<T>(fn: (file: LedgerFile) => T): T {
    return withFileLock(this.path, () => {
      const file = this.#read()
      const result = fn(file)
      this.#write(file)
      return result
    })
  }

  #spentToday(file: LedgerFile): number {
    const since = this.#now() - DAY_MS
    let total = 0
    for (const entry of Object.values(file.payments)) {
      if (entry.status !== 'failed' && entry.at > since) total += entry.chargedMsat
    }
    return total
  }

  #refusal(file: LedgerFile, paymentHash: string, amountMsat: number, unknownRefused = true): string | null {
    const prior = file.payments[paymentHash]
    if (prior?.status === 'paid') return 'That invoice has already been paid.'
    // A payment that may have gone out is not tried again until a lookup
    // shows it failed: a retry of an unknown outcome is how one invoice
    // gets paid twice.
    if (unknownRefused && (prior?.status === 'pending' || prior?.status === 'unknown')) {
      return `An earlier attempt to pay ${paymentHash} has an unknown outcome. Look the invoice up first; it is only retried once the wallet shows it failed.`
    }
    if (amountMsat > this.limits.maxPaymentMsat) {
      return `That is ${amountMsat} msat and bray's ceiling for one payment is ${this.limits.maxPaymentMsat} msat (BRAY_MAX_PAYMENT_MSAT).`
    }
    const needed = amountMsat + feeReserveMsat(amountMsat)
    const spent = this.#spentToday(file)
    if (spent + needed > this.limits.maxDailyMsat) {
      const left = Math.max(0, this.limits.maxDailyMsat - spent)
      return `That needs ${needed} msat including a fee reserve and ${left} msat of bray's 24-hour allowance is left (BRAY_MAX_DAILY_MSAT).`
    }
    return null
  }

  /**
   * Throw if the caps would refuse a payment, without recording anything.
   * An earlier attempt with an unknown outcome is left to the payment
   * itself, which looks it up before deciding.
   */
  check(paymentHash: string, amountMsat: number): void {
    const refusal = this.#refusal(this.#read(), paymentHash, amountMsat, false)
    if (refusal) throw new PaymentLimitError(refusal)
  }

  /**
   * Record a payment as about to be attempted, charging the amount plus a
   * fee reserve against the daily total. Written before the attempt, so a
   * crash mid-payment leaves the allowance spent rather than free.
   */
  reserve(paymentHash: string, amountMsat: number): void {
    this.#mutate((file) => {
      const refusal = this.#refusal(file, paymentHash, amountMsat)
      if (refusal) throw new PaymentLimitError(refusal)
      file.payments[paymentHash] = {
        chargedMsat: amountMsat + feeReserveMsat(amountMsat),
        amountMsat,
        status: 'pending',
        at: this.#now(),
      }
    })
  }

  /** The payment settled: charge the amount and the fee actually paid. */
  settle(paymentHash: string, feesPaidMsat: number | undefined): void {
    this.#mutate((file) => {
      const entry = file.payments[paymentHash]
      if (!entry) return
      entry.status = 'paid'
      // A wallet that does not report its fee keeps the reserve charged.
      if (feesPaidMsat !== undefined && Number.isSafeInteger(feesPaidMsat) && feesPaidMsat >= 0) {
        entry.chargedMsat = entry.amountMsat + feesPaidMsat
      }
    })
  }

  /** The wallet refused before anything left: give the allowance back. */
  release(paymentHash: string): void {
    this.#mutate((file) => {
      const entry = file.payments[paymentHash]
      if (!entry) return
      entry.status = 'failed'
      entry.chargedMsat = 0
    })
  }

  /** Something may have gone out: keep the whole reservation charged. */
  markUnknown(paymentHash: string): void {
    this.#mutate((file) => {
      const entry = file.payments[paymentHash]
      if (entry) entry.status = 'unknown'
    })
  }

  status(paymentHash: string): PaymentStatus | undefined {
    return this.#read().payments[paymentHash]?.status
  }

  /** Total counted against the rolling 24-hour allowance. */
  spentTodayMsat(): number {
    return this.#spentToday(this.#read())
  }
}

/** The guard every spending surface uses unless a test hands in its own. */
export function defaultPaymentGuard(): PaymentGuard {
  return new PaymentGuard()
}
