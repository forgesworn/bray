#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
  name: 'nostr-bray',
  version: '0.1.0',
})

// Tool registrations will be added as each group is implemented

if (process.env.TRANSPORT === 'http') {
  console.error('HTTP transport not yet implemented')
  process.exit(1)
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('nostr-bray started (stdio)')
}
