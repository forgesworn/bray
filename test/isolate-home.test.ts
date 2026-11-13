import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

describe('test isolation', () => {
  it('gives each test file a throwaway home', () => {
    // Without test/setup/isolate-home.ts this is the developer's own home,
    // and bray's state directory under it is their real one.
    expect(homedir().startsWith(join(tmpdir(), 'bray-test-home-'))).toBe(true)
    expect(process.env.XDG_CONFIG_HOME).toBe(join(homedir(), '.config'))
    expect(process.env.BRAY_CONFIG).toBeUndefined()
  })
})
