import { describe, it, expect } from 'vitest'
import { isValueDomain } from './value-domains'

describe('isValueDomain', () => {
  it('flags auction/design marketplaces', () => {
    expect(isValueDomain('https://www.1stdibs.com/furniture/x')).toBe(true)
    expect(isValueDomain('https://www.selency.fr/p/abc')).toBe(true)
    expect(isValueDomain('https://www.sothebys.com/lot/1')).toBe(true)
  })
  it('rejects generic marketplaces', () => {
    expect(isValueDomain('https://www.amazon.com/x')).toBe(false)
    expect(isValueDomain('https://youtube.com/watch')).toBe(false)
  })
})
