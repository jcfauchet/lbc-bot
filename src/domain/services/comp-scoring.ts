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

function toEur(value: number, currency: string): number {
  const rate = FX_TO_EUR[currency.toUpperCase()] ?? 1
  return Math.round(value * rate)
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
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
  return {
    estimatedValueEur: median(prices),
    rangeMinEur: prices[0],
    rangeMaxEur: prices[count - 1],
    pricedCompCount: count,
    confidence: count >= 3 ? 'reliable' : 'to_verify',
  }
}
