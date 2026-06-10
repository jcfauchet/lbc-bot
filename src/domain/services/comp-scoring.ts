import type { CompMatch } from './ICompService'

export type CompConfidence = 'reliable' | 'to_verify' | 'identified_no_price'

export interface CompScore {
  estimatedValueEur: number | null
  rangeMinEur: number | null
  rangeMaxEur: number | null
  pricedCompCount: number
  confidence: CompConfidence
}

// Coarse, configurable-later FX. Kept simple on purpose for the MVP.
const FX_TO_EUR: Record<string, number> = { EUR: 1, USD: 0.92, GBP: 1.17 }

/**
 * Maximum interquartile spread, relative to the median, for which the comps are
 * considered to agree. Above this the priced comps disagree too much for the
 * estimate to be trusted, so confidence drops to `to_verify` even with 3+ comps.
 */
const MAX_RELIABLE_IQR_RATIO = 1

function toEur(value: number, currency: string): number {
  const rate = FX_TO_EUR[currency.toUpperCase()] ?? 1
  return Math.round(value * rate)
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** Linear-interpolation percentile (type 7, as in Excel/NumPy defaults). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]))
}

export function scoreComps(matches: CompMatch[]): CompScore {
  const prices = matches
    .filter((c) => c.isValueDomain && c.price)
    .map((c) => toEur(c.price!.value, c.price!.currency))
    .sort((a, b) => a - b)

  const count = prices.length
  if (count === 0) {
    return {
      estimatedValueEur: null, rangeMinEur: null, rangeMaxEur: null,
      pricedCompCount: 0, confidence: 'identified_no_price',
    }
  }

  const med = median(prices)
  // Report the interquartile band rather than the raw min/max: this keeps the
  // estimate tight and prevents a lone luxury comp from producing a "2500–8800€"
  // range that the user (rightly) judged useless.
  const rangeMin = percentile(prices, 25)
  const rangeMax = percentile(prices, 75)

  const iqrRatio = med > 0 ? (rangeMax - rangeMin) / med : Infinity
  const compsAgree = iqrRatio <= MAX_RELIABLE_IQR_RATIO

  return {
    estimatedValueEur: med,
    rangeMinEur: rangeMin,
    rangeMaxEur: rangeMax,
    pricedCompCount: count,
    confidence: count >= 3 && compsAgree ? 'reliable' : 'to_verify',
  }
}
