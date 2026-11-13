import { describe, it, expect } from 'vitest'
import { errorMessage } from '../src/error-message.js'

describe('errorMessage', () => {
  it('reads an Error', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input')
  })

  it('passes a bare string through, as nostr-tools rejects with', () => {
    expect(errorMessage('connection timed out')).toBe('connection timed out')
  })

  it('never serialises a rejected object', () => {
    expect(errorMessage({ secret: 'do-not-log' })).toBe('[object Object]')
  })

  it('answers for a value with no toString', () => {
    expect(errorMessage(Object.create(null))).toBe('unknown error')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})
