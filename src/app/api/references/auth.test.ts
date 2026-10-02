import { describe, it, expect } from 'vitest'
import { isReferencesKeyValid } from './auth'

describe('isReferencesKeyValid', () => {
  it('accepts the exact key', () => expect(isReferencesKeyValid('s3cret-key-123456', 's3cret-key-123456')).toBe(true))
  it('rejects a wrong, missing or differently sized key', () => {
    expect(isReferencesKeyValid('wrong-key-1234567', 's3cret-key-123456')).toBe(false)
    expect(isReferencesKeyValid(null, 's3cret-key-123456')).toBe(false)
    expect(isReferencesKeyValid('short', 's3cret-key-123456')).toBe(false)
  })
  it('locks everything when no key is configured', () => {
    expect(isReferencesKeyValid('anything', undefined)).toBe(false)
    expect(isReferencesKeyValid('', '')).toBe(false)
  })
})
