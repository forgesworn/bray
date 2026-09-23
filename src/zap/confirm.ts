import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// A human, not the model, says yes to a payment.
//
// `confirm: true` on a tool call is set by the model, so on its own it is
// the model agreeing with itself. When the MCP client supports
// elicitation, bray asks the person at the keyboard directly and pays only
// on an explicit approval. A client without elicitation falls back to the
// `confirm` flag, with bray's spending caps still applying.

export type HumanApproval = 'approved' | 'declined' | 'unavailable'

interface ElicitingServer {
  getClientCapabilities(): { elicitation?: Record<string, unknown> } | undefined
  elicitInput(params: {
    mode?: 'form'
    message: string
    requestedSchema: {
      type: 'object'
      properties: Record<string, { type: 'boolean'; title?: string; description?: string; default?: boolean }>
      required?: string[]
    }
  }): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }>
}

function elicitingServer(server: McpServer): ElicitingServer | null {
  const inner = (server as unknown as { server?: Partial<ElicitingServer> }).server
  if (!inner || typeof inner.getClientCapabilities !== 'function' || typeof inner.elicitInput !== 'function') {
    return null
  }
  return inner as ElicitingServer
}

export function clientCanElicit(server: McpServer): boolean {
  const inner = elicitingServer(server)
  if (!inner) return false
  const elicitation = inner.getClientCapabilities()?.elicitation
  if (!elicitation || typeof elicitation !== 'object') return false
  // An empty capability object means form elicitation (the pre-modes shape).
  return 'form' in elicitation ? Boolean(elicitation.form) : Object.keys(elicitation).length === 0
}

/**
 * Ask the person using the MCP client to approve a payment.
 *
 * Returns `unavailable` when the client cannot be asked. Any failure to get
 * a clear yes once asking is possible is a `declined`: a payment is never
 * made because a prompt went wrong.
 */
export async function askHumanToApprovePayment(
  server: McpServer,
  details: { amountMsats: number; purpose: string; description?: string; paymentHash?: string },
): Promise<HumanApproval> {
  if (!clientCanElicit(server)) return 'unavailable'
  const inner = elicitingServer(server)!
  const sats = details.amountMsats / 1000
  const lines = [
    `bray wants to spend ${details.amountMsats} msat (${sats} sats) to ${details.purpose}.`,
    ...(details.description ? [`Invoice description: ${details.description}`] : []),
    ...(details.paymentHash ? [`Payment hash: ${details.paymentHash}`] : []),
    'Approve only if you asked for this payment.',
  ]
  try {
    const result = await inner.elicitInput({
      mode: 'form',
      message: lines.join('\n'),
      requestedSchema: {
        type: 'object',
        properties: {
          approve: {
            type: 'boolean',
            title: 'Approve this payment',
            description: `Pay ${details.amountMsats} msat`,
            default: false,
          },
        },
        required: ['approve'],
      },
    })
    return result.action === 'accept' && result.content?.approve === true ? 'approved' : 'declined'
  } catch {
    return 'declined'
  }
}
