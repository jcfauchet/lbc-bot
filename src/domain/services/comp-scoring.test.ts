import { describe, it, expect } from 'vitest'
import { scoreComps, isMassMarketCommon } from './comp-scoring'
import type { CompMatch } from './ICompService'

const m = (value: number | undefined, isValueDomain: boolean, currency = 'EUR'): CompMatch => ({
  title: 't', source: 's', link: 'l', isValueDomain,
  price: value === undefined ? undefined : { value, currency },
})

const match = (opts: Partial<CompMatch>): CompMatch => ({
  title: 't', source: 's', link: 'l', isValueDomain: false, ...opts,
})

describe('scoreComps', () => {
  it('returns reliable with median and an interquartile range from priced value comps (>=3)', () => {
    const r = scoreComps([m(1000, true), m(2000, true), m(3000, true), m(99, false)])
    expect(r.confidence).toBe('reliable')
    expect(r.pricedCompCount).toBe(3)
    expect(r.estimatedValueEur).toBe(2000)
    // Range is the interquartile band (p25-p75), not the raw min/max, so a
    // single outlier comp cannot blow the estimate wide open.
    expect(r.rangeMinEur).toBe(1500)
    expect(r.rangeMaxEur).toBe(2500)
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

  it('drops the single highest comp when there are >=4, so a lone luxury comp cannot inflate the estimate', () => {
    // A lone 5000€ dealer comp used to poison the median/range and manufacture a
    // phantom margin. With >=4 comps the top one is trimmed, leaving a clean,
    // agreeing estimate of ~200€.
    const r = scoreComps([m(100, true), m(200, true), m(300, true), m(5000, true)])
    expect(r.pricedCompCount).toBe(3)
    expect(r.estimatedValueEur).toBe(200)
    expect(r.confidence).toBe('reliable')
  })

  it('still downgrades to to_verify when the comps disagree even after trimming the top one', () => {
    // Two high comps: trimming one still leaves a wide spread, so the estimate
    // is not trustworthy.
    const r = scoreComps([m(100, true), m(200, true), m(3000, true), m(5000, true)])
    expect(r.confidence).toBe('to_verify')
  })

  it('does not trim when there are fewer than 4 priced comps', () => {
    // Only 3 comps: too few to safely drop one, so a lone outlier keeps the
    // estimate in to_verify rather than silently reliable.
    const r = scoreComps([m(100, true), m(200, true), m(5000, true)])
    expect(r.pricedCompCount).toBe(3)
    expect(r.confidence).toBe('to_verify')
  })

  it('converts USD to EUR with the fixed rate', () => {
    const r = scoreComps([m(1000, true, 'USD'), m(1000, true, 'USD'), m(1000, true, 'USD')])
    // 1000 USD * 0.92 = 920
    expect(r.estimatedValueEur).toBe(920)
  })
})

describe('isMassMarketCommon', () => {
  it('flags a piece with enough mass-market matches outnumbering value comps', () => {
    const matches = [
      match({ isMassMarket: true }), match({ isMassMarket: true }),
      match({ isMassMarket: true }), match({ isValueDomain: true }),
    ]
    expect(isMassMarketCommon(matches, 3)).toBe(true)
  })

  it('does not flag when value comps outnumber mass-market ones', () => {
    const matches = [
      match({ isMassMarket: true }), match({ isMassMarket: true }),
      match({ isValueDomain: true }), match({ isValueDomain: true }),
      match({ isValueDomain: true }),
    ]
    expect(isMassMarketCommon(matches, 2)).toBe(false)
  })

  it('does not flag below the minimum match count', () => {
    expect(isMassMarketCommon([match({ isMassMarket: true }), match({ isMassMarket: true })], 3)).toBe(false)
  })

  it('is disabled when the threshold is 0', () => {
    const matches = Array.from({ length: 5 }, () => match({ isMassMarket: true }))
    expect(isMassMarketCommon(matches, 0)).toBe(false)
  })
})
