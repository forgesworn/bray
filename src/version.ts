import { createRequire } from 'node:module'

// Read from package.json at runtime so the version the MCP server reports
// cannot drift from the one that was published. From both src/ (tests) and
// dist/ (the build), package.json is one directory up.
const require = createRequire(import.meta.url)

export const BRAY_VERSION: string = (require('../package.json') as { version: string }).version
