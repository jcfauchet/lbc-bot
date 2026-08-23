import { describe, it, expect } from 'vitest'
import { normalizeCookieHeader } from './LeBonCoinApiClient'

describe('normalizeCookieHeader', () => {
  it('names a bare value so it survives as a Cookie header', () => {
    // The env var held 128 chars with no `datadome=` prefix, which produced a
    // nameless Cookie header the server discarded -- the fallback could never
    // have worked.
    expect(normalizeCookieHeader('hRwEYVmyXhn')).toBe('datadome=hRwEYVmyXhn')
  })

  it('leaves an already-named cookie alone', () => {
    expect(normalizeCookieHeader('datadome=abc123')).toBe('datadome=abc123')
  })

  it('does not rename some other named cookie', () => {
    expect(normalizeCookieHeader('other_cookie=abc')).toBe('other_cookie=abc')
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(normalizeCookieHeader('  datadome=abc  ')).toBe('datadome=abc')
  })

  it('returns empty for a missing or blank value', () => {
    expect(normalizeCookieHeader(undefined)).toBe('')
    expect(normalizeCookieHeader('   ')).toBe('')
  })
})
