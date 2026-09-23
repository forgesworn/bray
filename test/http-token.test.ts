import { describe, expect, it } from 'vitest'
import { resolveHttpToken } from '../src/http-token.js'

describe('HTTP bearer token', () => {
  it('never prints a token the operator supplied', () => {
    const logged: string[] = []
    const token = resolveHttpToken({ BRAY_HTTP_TOKEN: 'operator-secret-token' }, (line) => logged.push(line))
    expect(token).toBe('operator-secret-token')
    expect(logged.join('\n')).not.toContain('operator-secret-token')
  })

  it('prints a generated token once, since nobody else can know it', () => {
    const logged: string[] = []
    const token = resolveHttpToken({}, (line) => logged.push(line))
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    expect(logged).toEqual([`nostr-bray HTTP auth token: ${token}`])
  })

  it('does not accept an empty token as a password', () => {
    const token = resolveHttpToken({ BRAY_HTTP_TOKEN: '  ' }, () => {})
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
  })
})
