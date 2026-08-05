import { describe, it, expect } from 'vitest'
import {
  estimateRangeRatio,
  classifyCompSource,
  isEstimateTrustworthy,
  computeDealScore,
  CompSource,
} from './DealScoring'

describe('estimateRangeRatio', () => {
  it('returns the max/min ratio of the estimate band', () => {
    expect(estimateRangeRatio(10_000, 20_000)).toBe(2)
  })

  it('treats a zero or negative low end as maximally untrustworthy', () => {
    expect(estimateRangeRatio(0, 20_000)).toBe(Number.POSITIVE_INFINITY)
    expect(estimateRangeRatio(-100, 20_000)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('classifyCompSource', () => {
  it('flags luxury asking-price marketplaces', () => {
    expect(classifyCompSource('https://www.1stdibs.com/furniture/tables/x')).toBe(CompSource.LUXURY)
    expect(classifyCompSource('https://www.chairish.com/product/123')).toBe(CompSource.LUXURY)
    expect(classifyCompSource('https://www.pamono.com/italian-travertine')).toBe(CompSource.LUXURY)
    expect(classifyCompSource('https://www.invaluable.com/auction-lot/x')).toBe(CompSource.LUXURY)
  })

  it('flags realistic French resale sources', () => {
    expect(classifyCompSource('Selency')).toBe(CompSource.RESALE)
    expect(classifyCompSource('https://www.proantic.com/x')).toBe(CompSource.RESALE)
    expect(classifyCompSource('https://www.leboncoin.fr/x')).toBe(CompSource.RESALE)
  })

  it('returns UNKNOWN for anything else', () => {
    expect(classifyCompSource(null)).toBe(CompSource.UNKNOWN)
    expect(classifyCompSource('')).toBe(CompSource.UNKNOWN)
    expect(classifyCompSource('https://example.com')).toBe(CompSource.UNKNOWN)
  })
})

describe('isEstimateTrustworthy', () => {
  const base = { priceCents: 10_000, estMinCents: 15_000, estMaxCents: 20_000, bestMatchSource: 'Selency' }

  it('accepts a tight band backed by a resale comp', () => {
    expect(isEstimateTrustworthy(base)).toBe(true)
  })

  it('rejects a band wider than the configured ratio', () => {
    // 1_108€ -> 18_623€ : the real case that produced "stop making up numbers"
    expect(
      isEstimateTrustworthy({ ...base, estMinCents: 110_800, estMaxCents: 1_862_300 })
    ).toBe(false)
  })

  it('honours a custom max ratio', () => {
    const wide = { ...base, estMinCents: 10_000, estMaxCents: 30_000 } // ratio 3
    expect(isEstimateTrustworthy(wide, { maxRangeRatio: 2.5 })).toBe(false)
    expect(isEstimateTrustworthy(wide, { maxRangeRatio: 4 })).toBe(true)
  })

  it('rejects when the conservative margin (estMin - price) is below the floor', () => {
    expect(
      isEstimateTrustworthy({ ...base, estMinCents: 10_500 }, { minConservativeMarginCents: 1_000 })
    ).toBe(false)
    expect(
      isEstimateTrustworthy({ ...base, estMinCents: 12_000 }, { minConservativeMarginCents: 1_000 })
    ).toBe(true)
  })
})

describe('computeDealScore', () => {
  const at = (over: Partial<Parameters<typeof computeDealScore>[0]> = {}) =>
    computeDealScore({
      priceCents: 20_000,
      estMinCents: 30_000,
      estMaxCents: 40_000,
      bestMatchSource: 'Selency',
      ...over,
    })

  it('ranks a resale-backed comp above a luxury-backed one, all else equal', () => {
    expect(at({ bestMatchSource: 'Selency' })).toBeGreaterThan(
      at({ bestMatchSource: 'https://www.1stdibs.com/x' })
    )
  })

  it('ranks a tight estimate band above a wide one', () => {
    expect(at({ estMinCents: 30_000, estMaxCents: 36_000 })).toBeGreaterThan(
      at({ estMinCents: 30_000, estMaxCents: 150_000 })
    )
  })

  it('does NOT reward a larger median margin — the backtest showed that signal inverted', () => {
    // Same band width and source; only the absolute estimate level differs.
    const modest = at({ estMinCents: 30_000, estMaxCents: 36_000 })
    const grandiose = at({ estMinCents: 300_000, estMaxCents: 360_000 })
    expect(grandiose).toBeLessThanOrEqual(modest)
  })

  it('is deterministic', () => {
    expect(at()).toBe(at())
  })
})
