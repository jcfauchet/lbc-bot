import { describe, it, expect } from 'vitest'
import { scoreComps } from './comp-scoring'
import type { CompMatch } from './ICompService'

const m = (value: number | undefined, isValueDomain: boolean, currency = 'EUR'): CompMatch => ({
  title: 't', source: 's', link: 'l', isValueDomain,
  price: value === undefined ? undefined : { value, currency },
})

describe('scoreComps', () => {
  it('returns reliable with median/range from priced value comps (>=3)', () => {
    const r = scoreComps([m(1000, true), m(2000, true), m(3000, true), m(99, false)])
    expect(r.confidence).toBe('reliable')
    expect(r.pricedCompCount).toBe(3)
    expect(r.estimatedValueEur).toBe(2000)
    expect(r.rangeMinEur).toBe(1000)
    expect(r.rangeMaxEur).toBe(3000)
  })

  it('ignores priced comps that are not on value domains', () => {
    const r = scoreComps([m(5000, false), m(5000, false)])
    expect(r.pricedCompCount).toBe(0)
    expect(r.confidence).toBe('identified_no_price')
    expect(r.estimatedValueEur).toBeNull()
  })

  it('marks 1-2 priced value comps as to_verify', () => {
    const r = scoreComps([m(1200, true), m(1800, true)])
    expect(r.confidence).toBe('to_verify')
    expect(r.estimatedValueEur).toBe(1500)
  })

  it('converts USD to EUR with the fixed rate', () => {
    const r = scoreComps([m(1000, true, 'USD'), m(1000, true, 'USD'), m(1000, true, 'USD')])
    // 1000 USD * 0.92 = 920
    expect(r.estimatedValueEur).toBe(920)
  })
})
