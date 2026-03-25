import type { z } from 'zod'

/** Standard output format parameter — add to any tool's inputSchema */
export const outputFormatParam = {
  description: 'Response format: "json" (default, structured data) or "human" (readable text)',
} as const

/**
 * Build an MCP tool response with optional human formatting.
 *
 * Usage in tool registrations:
 *   return toolResponse(data, args.output, formatFn)
 *
 * If output === 'human' and a formatter is provided, returns formatted text.
 * Otherwise returns JSON (the default for MCP).
 */
export function toolResponse(
  data: unknown,
  output: string | undefined,
  humanFormatter?: (d: any) => string,
): { content: Array<{ type: 'text'; text: string }> } {
  if (output === 'human' && humanFormatter) {
    return { content: [{ type: 'text' as const, text: humanFormatter(data) }] }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}
