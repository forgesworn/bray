import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// nostr-tools is pinned to an exact version on purpose. 2.25.2 closes a
// still-connecting `ws` socket on connection timeout after removing its error
// handler, so a slow relay crashes the whole Node process
// (nbd-wtf/nostr-tools#557). A caret range lets a fresh install of bray pick
// that version up even though the lock file says otherwise, because consumers
// never see our lock file. Move the pin only to a version that has been checked
// against #557.
//
// Checked 2026-11-12 with plain ws 8.22.2 on Node 24, against a relay that
// accepts TCP and never answers the upgrade: 2.24.1 survives the connection
// timeout; 2.25.2 and 2.26.0 exit with "WebSocket was closed before the
// connection was established" (#557 was still open). bray's SafeWebSocket
// survives on all three. Not checked: #539, or releases between 2.25.2 and 2.26.0.

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('nostr-tools pin', () => {
  it('is an exact version, not a range', () => {
    expect(pkg.dependencies['nostr-tools']).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('is not a version known to crash on connection timeout', () => {
    expect(['2.25.2', '2.26.0']).not.toContain(pkg.dependencies['nostr-tools'])
  })
})
