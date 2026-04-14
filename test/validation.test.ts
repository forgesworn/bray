import { describe, it, expect } from 'vitest'
import { validatePublicUrl } from '../src/validation.js'
import { validateRelayUrl } from '../src/relay/handlers.js'

describe('validatePublicUrl', () => {
  it('accepts a normal public URL', () => {
    expect(() => validatePublicUrl('https://example.com')).not.toThrow()
    expect(() => validatePublicUrl('https://relay.damus.io')).not.toThrow()
    expect(() => validatePublicUrl('wss://nos.lol:443')).not.toThrow()
  })

  it('rejects IPv4 loopback', () => {
    expect(() => validatePublicUrl('http://127.0.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://127.0.0.1:8080')).toThrow(/private/)
    expect(() => validatePublicUrl('ws://127.1.2.3')).toThrow(/private/)
  })

  it('rejects RFC 1918 private ranges', () => {
    expect(() => validatePublicUrl('http://10.0.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://192.168.1.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://172.16.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://172.31.0.1')).toThrow(/private/)
  })

  it('allows 172.32.x (outside RFC 1918 172.16/12)', () => {
    expect(() => validatePublicUrl('http://172.32.0.1')).not.toThrow()
  })

  it('rejects link-local and cloud metadata', () => {
    expect(() => validatePublicUrl('http://169.254.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://169.254.169.254')).toThrow(/private/)
    expect(() => validatePublicUrl('http://metadata.google.internal')).toThrow(/private/)
    expect(() => validatePublicUrl('http://metadata.aws')).toThrow(/private/)
  })

  it('rejects 0.0.0.0/8', () => {
    expect(() => validatePublicUrl('http://0.0.0.0')).toThrow(/private/)
    expect(() => validatePublicUrl('http://0.1.2.3')).toThrow(/private/)
  })

  it('rejects 100.64.0.0/10 (CGNAT)', () => {
    expect(() => validatePublicUrl('http://100.64.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://100.100.0.1')).toThrow(/private/)
    expect(() => validatePublicUrl('http://100.127.255.255')).toThrow(/private/)
  })

  it('allows 100.0.x and 100.128.x (outside CGNAT)', () => {
    expect(() => validatePublicUrl('http://100.0.0.1')).not.toThrow()
    expect(() => validatePublicUrl('http://100.128.0.1')).not.toThrow()
  })

  it('rejects IPv6 loopback and unspecified', () => {
    expect(() => validatePublicUrl('http://[::1]')).toThrow(/private/)
    expect(() => validatePublicUrl('http://[::]')).toThrow(/private/)
    // Long-form loopback — URL class normalises to ::1
    expect(() => validatePublicUrl('http://[0:0:0:0:0:0:0:1]')).toThrow(/private/)
  })

  it('rejects IPv4-mapped IPv6', () => {
    expect(() => validatePublicUrl('http://[::ffff:127.0.0.1]')).toThrow(/private/)
  })

  it('rejects IPv6 ULA fc00::/7', () => {
    expect(() => validatePublicUrl('http://[fc00::1]')).toThrow(/private/)
    expect(() => validatePublicUrl('http://[fd12:3456::1]')).toThrow(/private/)
  })

  it('rejects IPv6 link-local fe80::/10', () => {
    expect(() => validatePublicUrl('http://[fe80::1]')).toThrow(/private/)
  })

  it('rejects localhost variants', () => {
    expect(() => validatePublicUrl('http://localhost')).toThrow(/private/)
    expect(() => validatePublicUrl('http://localhost.')).toThrow(/private/)
    expect(() => validatePublicUrl('http://foo.localhost')).toThrow(/private/)
  })

  it('rejects .local and .internal TLDs', () => {
    expect(() => validatePublicUrl('http://myservice.local')).toThrow(/private/)
    expect(() => validatePublicUrl('http://db.internal')).toThrow(/private/)
  })

  it('rejects integer-only hostnames (decimal IP obfuscation)', () => {
    // 2130706433 = 127.0.0.1
    expect(() => validatePublicUrl('http://2130706433')).toThrow(/obfuscated|private/i)
  })

  it('rejects hex/octal-obfuscated hostnames', () => {
    expect(() => validatePublicUrl('http://0x7f.0x0.0x0.0x1')).toThrow(/obfuscated|private/i)
    expect(() => validatePublicUrl('http://0177.0.0.1')).toThrow(/obfuscated|private/i)
  })

  it('rejects malformed URLs', () => {
    expect(() => validatePublicUrl('not a url')).toThrow(/malformed|hostname/i)
  })
})

describe('validateRelayUrl', () => {
  it('accepts normal relay URLs', () => {
    expect(() => validateRelayUrl('wss://relay.damus.io')).not.toThrow()
    expect(() => validateRelayUrl('ws://relay.example.com')).not.toThrow()
  })

  it('rejects wrong scheme', () => {
    expect(() => validateRelayUrl('http://relay.damus.io')).toThrow(/scheme/i)
    expect(() => validateRelayUrl('https://relay.damus.io')).toThrow(/scheme/i)
    expect(() => validateRelayUrl('file:///etc/passwd')).toThrow(/scheme/i)
  })

  it('rejects private-network relays', () => {
    expect(() => validateRelayUrl('ws://127.0.0.1')).toThrow(/private/)
    expect(() => validateRelayUrl('wss://localhost')).toThrow(/private/)
    expect(() => validateRelayUrl('ws://[::1]')).toThrow(/private/)
    expect(() => validateRelayUrl('ws://169.254.169.254')).toThrow(/private/)
  })

  it('rejects oversized URLs', () => {
    const long = 'wss://' + 'a'.repeat(600) + '.example.com'
    expect(() => validateRelayUrl(long)).toThrow(/too long/i)
  })

  it('rejects non-string input', () => {
    expect(() => validateRelayUrl(123 as unknown as string)).toThrow(/string/i)
    expect(() => validateRelayUrl(null as unknown as string)).toThrow()
  })
})
