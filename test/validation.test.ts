import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validatePublicUrl,
  validateRelayScheme,
  isOnionUrl,
  validateInputPath,
  getInputAllowlist,
} from '../src/validation.js'
import { validateRelayUrl } from '../src/relay/handlers.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

describe('isOnionUrl', () => {
  it('matches v3 onion (56 chars)', () => {
    const v3 = 'a'.repeat(56) + '.onion'
    expect(isOnionUrl(`ws://${v3}`)).toBe(true)
    expect(isOnionUrl(`wss://${v3}`)).toBe(true)
    expect(isOnionUrl(`http://${v3}/`)).toBe(true)
  })

  it('matches v2 onion (16 chars)', () => {
    expect(isOnionUrl('ws://abcdefghijklmnop.onion')).toBe(true)
  })

  it('rejects bogus onion-shaped hosts', () => {
    expect(isOnionUrl('ws://127.0.0.1.onion')).toBe(false)
    expect(isOnionUrl('ws://shortname.onion')).toBe(false)
    expect(isOnionUrl('ws://example.com')).toBe(false)
    expect(isOnionUrl('not-a-url')).toBe(false)
    expect(isOnionUrl('')).toBe(false)
  })
})

describe('validateRelayScheme', () => {
  it('permits wss:// to anywhere', () => {
    expect(() => validateRelayScheme('wss://relay.damus.io')).not.toThrow()
    expect(() => validateRelayScheme('wss://nos.lol')).not.toThrow()
  })

  it('permits ws:// to .onion services', () => {
    const v3 = 'a'.repeat(56) + '.onion'
    expect(() => validateRelayScheme(`ws://${v3}`)).not.toThrow()
    expect(() => validateRelayScheme('ws://abcdefghijklmnop.onion')).not.toThrow()
  })

  it('rejects ws:// to clearnet hosts', () => {
    expect(() => validateRelayScheme('ws://relay.example.com')).toThrow(/onion/)
    expect(() => validateRelayScheme('ws://nos.lol')).toThrow(/onion/)
  })

  it('honours allowPrivate escape hatch for local dev', () => {
    expect(() => validateRelayScheme('ws://localhost:10547', true)).not.toThrow()
    expect(() => validateRelayScheme('ws://localhost:10547', false)).toThrow(/onion/)
  })
})

describe('validateInputPath', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'bray-validate-path-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('accepts a path under the provided allowlist', () => {
    const file = join(workDir, 'shard.bray')
    writeFileSync(file, 'contents')
    expect(() => validateInputPath(file, [workDir])).not.toThrow()
    expect(validateInputPath(file, [workDir])).toBe(file)
  })

  it('rejects absolute paths outside the allowlist', () => {
    expect(() => validateInputPath('/etc/shadow', [workDir])).toThrow(/outside the input allowlist/)
    expect(() => validateInputPath('/etc/passwd', [workDir])).toThrow(/outside the input allowlist/)
  })

  it('rejects traversal attempts that resolve outside the allowlist', () => {
    const traversal = join(workDir, '..', '..', 'etc', 'passwd')
    expect(() => validateInputPath(traversal, [workDir])).toThrow(/outside the input allowlist/)
  })

  it('rejects empty and over-long paths', () => {
    expect(() => validateInputPath('', [workDir])).toThrow(/non-empty/)
    expect(() => validateInputPath('/x'.repeat(3000), [workDir])).toThrow(/too long/)
  })

  it('default allowlist includes cwd and os tmpdir', () => {
    const allowlist = getInputAllowlist()
    expect(allowlist.some(d => d === process.cwd())).toBe(true)
    expect(allowlist.some(d => d.startsWith(tmpdir()) || tmpdir().startsWith(d))).toBe(true)
  })

  it('BRAY_INPUT_DIRS env override replaces defaults', () => {
    const prev = process.env.BRAY_INPUT_DIRS
    process.env.BRAY_INPUT_DIRS = `${workDir}:/nonexistent/other`
    try {
      const allowlist = getInputAllowlist()
      expect(allowlist).toContain(workDir)
      expect(allowlist).toContain('/nonexistent/other')
      expect(allowlist).not.toContain(process.cwd())
    } finally {
      if (prev === undefined) delete process.env.BRAY_INPUT_DIRS
      else process.env.BRAY_INPUT_DIRS = prev
    }
  })
})
