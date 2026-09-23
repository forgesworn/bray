import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDeps } from './identity/tools.js'
import { registerIdentityTools } from './identity/tools.js'
import { registerSocialTools } from './social/tools.js'
import { registerTrustTools } from './trust/tools.js'
import { registerRelayTools } from './relay/tools.js'
import { registerRelayIntelligenceTools } from './relay/intelligence-tools.js'
import { registerZapTools } from './zap/tools.js'
import { registerWalletServiceTools } from './wallet-service/tools.js'
import { registerSafetyTools } from './safety/tools.js'
import { registerUtilTools } from './util/tools.js'
import { registerWorkflowTools } from './workflow/tools.js'
import { registerMarketplaceTools } from './marketplace/tools.js'
import { registerPrivacyTools } from './privacy/tools.js'
import { registerModerationTools } from './moderation/tools.js'
import { registerSignetTools } from './signet/tools.js'
import { registerVaultTools } from './vault/tools.js'
import { registerDispatchTools } from './dispatch/tools.js'
import { registerHandlerTools } from './handler/tools.js'
import { registerSyncTools } from './sync/tools.js'

export interface ToolGroupOptions {
  veilCacheTtl: number
  veilCacheMax: number
  /** Dispatch tools are registered only when an identities file is configured. */
  dispatchIdentitiesPath?: string
  /** wallet-grant, wallet-refill and wallet-serve are registered only when true. */
  walletService?: boolean
}

/**
 * Register every tool group, in one place. The MCP server, the tool-schema
 * export and the tool-count test all go through this, so the number of
 * tools the docs quote is the number the server registers.
 */
export function registerAllTools(server: McpServer, deps: ToolDeps, options: ToolGroupOptions): void {
  registerIdentityTools(server, deps)
  registerSocialTools(server, deps)
  registerTrustTools(server, deps)
  registerRelayTools(server, deps)
  registerRelayIntelligenceTools(server, deps)
  registerZapTools(server, deps)
  registerWalletServiceTools(server, deps, { issuing: options.walletService === true })
  registerSafetyTools(server, deps)
  registerUtilTools(server, deps)
  registerWorkflowTools(server, {
    ctx: deps.ctx,
    pool: deps.pool,
    nip65: deps.nip65,
    veilCacheTtl: options.veilCacheTtl,
    veilCacheMax: options.veilCacheMax,
    trust: deps.trust,
  })
  registerMarketplaceTools(server, deps)
  registerPrivacyTools(server, deps)
  registerModerationTools(server, deps)
  registerSignetTools(server, deps)
  registerVaultTools(server, deps)
  registerDispatchTools(server, {
    ...deps,
    ...(options.dispatchIdentitiesPath ? { dispatchIdentitiesPath: options.dispatchIdentitiesPath } : {}),
  })
  registerHandlerTools(server, deps)
  registerSyncTools(server, deps)
}
