import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every pool must be given its WebSocket class (webSocketFor), so TOR_PROXY
// and SafeWebSocket apply and no process-wide default can undo them.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('WebSocket class for relay pools', () => {
  it('no source file builds a SimplePool without an explicit websocketImplementation', () => {
    const offenders = sources(join(import.meta.dirname, '..', 'src'))
      .filter(path => /new SimplePool\(\s*\)/.test(readFileSync(path, 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('only relay-pool sets the process-wide WebSocket class', () => {
    const setters = sources(join(import.meta.dirname, '..', 'src'))
      .filter(path => /useWebSocketImplementation\(/.test(readFileSync(path, 'utf-8')))
      .map(path => path.split('/src/')[1])
    expect(setters).toEqual(['relay-pool.ts'])
  })
})
