import { describe, it, expect } from 'vitest'
import { handleAcceptMigration } from '../../src/identity/handlers.js'

describe('handleAcceptMigration', () => {
  it('is exported as a function', () => {
    expect(typeof handleAcceptMigration).toBe('function')
  })
})
