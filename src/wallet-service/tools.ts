import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from '../identity/tools.js'
import { resolveNwcUri } from '../zap/handlers.js'
import { defaultGrantsFile, loadGrants, saveGrants } from './grants.js'
import { upstreamWallet } from './upstream.js'
import {
  DEFAULT_METHODS,
  SUPPORTED_METHODS,
  WalletService,
  grantUri,
  newGrant,
  remainingBudgetMsat,
  type Grant,
} from './service.js'

// Handing out a wallet connection that is narrower than the one you hold.
//
// `zap-send` spends through the operator's own NWC URI, which is an
// unbounded capability: every method the wallet supports, no ceiling, for
// as long as it exists. These tools issue connections over that same
// wallet that are not - a method allowlist, a budget that spending
// requires, a per-payment ceiling, and a revocation that takes effect the
// moment it is asked for.
//
// Nothing is answered unless the service is running, and it runs for as
// long as this process does. That is worth saying out loud rather than
// leaving someone to discover it: a grant handed to an agent that only
// works while an MCP session is open is a different promise from one that
// works overnight.

// The running service, and the grant objects it was handed. The service
// mutates those in place - a budget it has spent, a request id it has
// answered - so persisting means writing THOSE back, not re-writing
// whatever the file already said.
let service: WalletService | null = null
let servingFor: string | null = null
const served = new Map<string, Grant>()

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const shown = (grant: Grant) => ({
  id: grant.id,
  name: grant.name,
  methods: grant.methods,
  state: grant.revokedAt ? 'revoked' : 'live',
  ...(grant.budgetMsat === undefined
    ? {}
    : { budgetMsat: grant.budgetMsat, spentMsat: grant.spentMsat, remainingMsat: remainingBudgetMsat(grant) }),
  ...(grant.maxPaymentMsat === undefined ? {} : { maxPaymentMsat: grant.maxPaymentMsat }),
  ...(grant.lastUsedAt === undefined ? {} : { lastUsedAt: new Date(grant.lastUsedAt).toISOString() }),
})

export function registerWalletServiceTools(server: McpServer, deps: ToolDeps): void {
  const grantsFile = defaultGrantsFile()
  const identity = () => deps.ctx.activePublicKeyHex
  const read = () => loadGrants(grantsFile, identity())
  const write = (grants: Grant[]) => {
    saveGrants(grantsFile, identity(), grants)
  }

  const running = async (): Promise<WalletService> => {
    const pubkey = identity()
    // An identity switch is a different wallet and different grants, so the
    // old service is stopped rather than left answering under a name this
    // session no longer means.
    if (service && servingFor !== pubkey) {
      service.close()
      service = null
      served.clear()
    }
    if (service) return service
    const uri = resolveNwcUri(deps.ctx, deps.walletsFile, deps.nwcUri)
    if (!uri) throw new Error('No wallet is configured - `zap-wallet-set` points this identity at one first.')
    servingFor = pubkey
    service = new WalletService({
      wallet: upstreamWallet({ uri, alias: deps.ctx.activeNpub }),
      transport: {
        subscribe: (relays, filter, onEvent) => deps.pool.subscribe(relays, filter, onEvent),
        publish: async (relays, event) => {
          await deps.pool.publishDirect(relays, event)
        },
      },
      persist: async () => {
        // The in-memory grants win: they are the ones the service has been
        // charging. Anything on disk it is not serving is carried through
        // untouched.
        const stored = loadGrants(grantsFile, pubkey)
        saveGrants(
          grantsFile,
          pubkey,
          stored.map((held) => served.get(held.id) ?? held),
        )
      },
    })
    return service
  }

  const startServing = async (grant: Grant): Promise<void> => {
    served.set(grant.id, grant)
    await (await running()).serve(grant)
  }

  server.registerTool(
    'wallet-grant',
    {
      description:
        'Issue a NIP-47 connection over this identity\'s wallet, narrower than the URI you hold. Defaults to invoice-only: no spending and no balance disclosure. A connection that can spend must carry a budget. Returns the nostr+walletconnect:// URI to hand over.',
      inputSchema: {
        name: z.string().describe('What this connection is for - it is how you revoke the right one later'),
        methods: z
          .array(z.enum(SUPPORTED_METHODS))
          .optional()
          .describe(`NIP-47 methods this connection may call. Default: ${DEFAULT_METHODS.join(', ')}`),
        budgetMsat: z.number().int().positive().optional().describe('Total it may ever spend, in msat. Required with pay_invoice'),
        maxPaymentMsat: z.number().int().positive().optional().describe('Ceiling on any single payment, in msat'),
        relays: z.array(z.string()).optional().describe('Relays to answer on. Defaults to this identity\'s write relays'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ name, methods, budgetMsat, maxPaymentMsat, relays }) => {
      const grants = read()
      if (grants.some((held) => !held.revokedAt && held.name.toLowerCase() === name.trim().toLowerCase())) {
        throw new Error(`There is already a live connection called ${name}.`)
      }
      const on = relays?.length ? relays : deps.pool.getRelays(deps.ctx.activeNpub).write
      const grant = newGrant({
        name: name.trim(),
        relays: on,
        ...(methods ? { methods: [...methods] } : {}),
        ...(budgetMsat === undefined ? {} : { budgetMsat }),
        ...(maxPaymentMsat === undefined ? {} : { maxPaymentMsat }),
      })
      write([...grants, grant])
      if (service) await startServing(grant)
      return text({
        ok: true,
        ...shown(grant),
        uri: grantUri(grant),
        note: 'Whoever holds this URI can do exactly the above and nothing else. It is answered only while `wallet-serve` is running.',
      })
    },
  )

  server.registerTool(
    'wallet-grants',
    {
      description: 'List the NIP-47 connections issued over this identity\'s wallet, what each may do, and what it has spent. Secrets are never returned.',
      annotations: { readOnlyHint: true },
    },
    async () =>
      text({
        serving: service?.serving() ?? [],
        grants: read().map(shown),
      }),
  )

  server.registerTool(
    'wallet-revoke',
    {
      description: 'Revoke a connection by name or id. It stops being answered immediately; nothing needs to be published anywhere.',
      inputSchema: { nameOrId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ nameOrId }) => {
      const grants = read()
      const wanted = nameOrId.trim().toLowerCase()
      const grant =
        grants.find((held) => held.id === wanted) ??
        grants.find((held) => held.name.toLowerCase() === wanted) ??
        grants.find((held) => held.id.startsWith(wanted))
      if (!grant) throw new Error(`No connection here called ${nameOrId}.`)
      grant.revokedAt ??= Date.now()
      write(grants)
      service?.stop(grant.id)
      served.delete(grant.id)
      return text({ ok: true, ...shown(grant) })
    },
  )

  server.registerTool(
    'wallet-refill',
    {
      description: 'Put a spending connection\'s budget back where it started, optionally at a new figure. Deliberately separate from granting: topping up is a decision, not a side effect of use.',
      inputSchema: { nameOrId: z.string(), budgetMsat: z.number().int().positive().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ nameOrId, budgetMsat }) => {
      const grants = read()
      const wanted = nameOrId.trim().toLowerCase()
      const grant = grants.find((held) => held.id === wanted) ?? grants.find((held) => held.name.toLowerCase() === wanted)
      if (!grant) throw new Error(`No connection here called ${nameOrId}.`)
      if (grant.revokedAt) throw new Error('That connection is revoked - issue a new one.')
      if (grant.budgetMsat === undefined) throw new Error('That connection cannot spend, so it has no budget.')
      if (budgetMsat !== undefined) grant.budgetMsat = budgetMsat
      grant.spentMsat = 0
      write(grants)
      return text({ ok: true, ...shown(grant) })
    },
  )

  server.registerTool(
    'wallet-serve',
    {
      description:
        'Start or stop answering NIP-47 for the connections issued above. While it runs, holders of those URIs can call the methods their grant allows, against this identity\'s wallet. It answers only while this process is alive.',
      inputSchema: { action: z.enum(['start', 'stop', 'status']).default('status') },
      annotations: { readOnlyHint: false },
    },
    async ({ action }) => {
      if (action === 'stop') {
        service?.close()
        service = null
        servingFor = null
        served.clear()
        return text({ ok: true, serving: [], message: 'Stopped. Nothing is answered until it runs again.' })
      }
      if (action === 'start') {
        const live = read().filter((grant) => !grant.revokedAt)
        if (!live.length) throw new Error('Nothing to serve - `wallet-grant` issues a connection first.')
        for (const grant of live) await startServing(grant)
        return text({ ok: true, serving: service?.serving() ?? [], grants: live.map(shown) })
      }
      return text({ ok: true, running: service !== null, serving: service?.serving() ?? [] })
    },
  )
}
