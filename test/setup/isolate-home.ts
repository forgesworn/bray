// Runs before each test file, ahead of its imports (vitest `setupFiles`).
//
// bray keeps its state in $XDG_CONFIG_HOME/bray (default ~/.config/bray) and
// fixes that path when src/state.ts loads, so any test that started a bunker
// or a bunker client without its own `stateDir` wrote approvals and client
// keys into the developer's real state directory, run after run. Give every
// file a throwaway home instead, and drop BRAY_CONFIG, which config.ts reads
// before anything under home. A CLI a test spawns inherits the same.
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'bray-test-home-'))
process.env.HOME = home
process.env.USERPROFILE = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
delete process.env.BRAY_CONFIG

afterAll(() => rmSync(home, { recursive: true, force: true }))
