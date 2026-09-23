import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BRAY_VERSION } from '../src/version.js'

describe('reported version', () => {
  it('is the published package version, not a hard-coded one', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(BRAY_VERSION).toBe(pkg.version)
  })
})
