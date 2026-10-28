import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// nostr-tools is pinned to an exact version on purpose. 2.25.2 closes a
// still-connecting `ws` socket on connection timeout after removing its error
// handler, so a slow relay crashes the whole Node process
// (nbd-wtf/nostr-tools#557). A caret range lets a fresh install of bray pick
// that version up even though the lock file says otherwise, because consumers
// never see our lock file. Move the pin only to a version that has been checked
// against #557.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('nostr-tools pin', () => {
  it('is an exact version, not a range', () => {
    expect(pkg.dependencies['nostr-tools']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is not a version known to crash on connection timeout', () => {
    expect(['2.25.2']).not.toContain(pkg.dependencies['nostr-tools'])
  })
})
