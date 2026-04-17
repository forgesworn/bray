import { describe, it, expect } from 'vitest'
import {
  sanitiseTerminal,
  formatProfile,
  formatFeed,
  formatConversation,
} from '../src/format.js'

describe('sanitiseTerminal', () => {
  it('strips ANSI CSI sequences (colour, cursor)', () => {
    expect(sanitiseTerminal('hello \x1b[31mred\x1b[0m world')).toBe('hello [31mred[0m world')
    expect(sanitiseTerminal('\x1b[2J\x1b[H')).toBe('[2J[H')
  })

  it('strips OSC sequences (clipboard, title, hyperlinks)', () => {
    expect(sanitiseTerminal('\x1b]52;c;ZXZpbA==\x07')).toBe(']52;c;ZXZpbA==')
    expect(sanitiseTerminal('\x1b]0;hijacked title\x07tail')).toBe(']0;hijacked titletail')
  })

  it('strips DEL, BEL, BS, and other C0 control codes', () => {
    expect(sanitiseTerminal('\x07alarm')).toBe('alarm')
    expect(sanitiseTerminal('\x08\x08\x08overwrite')).toBe('overwrite')
    expect(sanitiseTerminal('\x7fdel')).toBe('del')
  })

  it('preserves tab, newline, and carriage return', () => {
    expect(sanitiseTerminal('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('passes printable text through untouched', () => {
    expect(sanitiseTerminal('plain ascii 123 ! @ # $ %')).toBe('plain ascii 123 ! @ # $ %')
    expect(sanitiseTerminal('emoji 🚀 — unicode é ñ ø')).toBe('emoji 🚀 — unicode é ñ ø')
  })
})

describe('format functions strip terminal escapes from relay content', () => {
  it('formatProfile defangs profile fields', () => {
    const out = formatProfile({
      name: 'Alice\x1b[31m',
      about: '\x1b]52;c;EVIL\x07benign-looking',
    })
    expect(out).not.toContain('\x1b')
    expect(out).not.toContain('\x07')
    expect(out).toContain('Alice')
    expect(out).toContain('benign-looking')
  })

  it('formatFeed defangs post content', () => {
    const out = formatFeed([{
      pubkey: '0123456789abcdef0123456789abcdef',
      createdAt: 1700000000,
      content: 'hello \x1b[2J\x1b[H gone',
    }])
    expect(out).not.toContain('\x1b')
    expect(out).toContain('hello')
  })

  it('formatConversation defangs DM content', () => {
    const out = formatConversation([{
      from: '0123456789abcdef0123456789abcdef',
      createdAt: 1700000000,
      decrypted: true,
      content: '\x1b]0;evil\x07legit message',
    }])
    expect(out).not.toContain('\x1b')
    expect(out).not.toContain('\x07')
    expect(out).toContain('legit message')
  })
})
