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
const MAX_RELIABLE_IQR_RATIO = 0.75

/**
 * With at least this many priced comps, the single most expensive one is dropped
 * before scoring. A lone luxury dealer comp (a 1stdibs/Chairish outlier) used to
 * inflate the median and manufacture a phantom margin — the dominant cause of the
 * "хватит придумывать цифры / estimation trop vaste" feedback. Below this count
 * there are too few comps to safely discard one.
 */
const MIN_COMPS_TO_TRIM_TOP = 4

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

/**
 * True when the reverse-image matches show the piece is a common, mass-produced
 * product currently sold new: at least `minMassMarketMatches` matches come from
 * retail/marketplace domains AND they outnumber the value/auction matches. Such
 * a piece has no resale edge regardless of a stray value comp, so it should be
 * dropped before it is estimated or notified.
 */
export function isMassMarketCommon(matches: CompMatch[], minMassMarketMatches: number): boolean {
  if (minMassMarketMatches <= 0) return false
  let massMarket = 0
  let value = 0
  for (const m of matches) {
    if (m.isMassMarket) massMarket++
    else if (m.isValueDomain) value++
  }
  return massMarket >= minMassMarketMatches && massMarket > value
}

export function scoreComps(matches: CompMatch[]): CompScore {
  const allPrices = matches
    .filter((c) => c.isValueDomain && c.price)
    .map((c) => toEur(c.price!.value, c.price!.currency))
    .sort((a, b) => a - b)

  // Trim the single most expensive comp once there are enough of them, so a lone
  // luxury outlier can no longer poison the median and the interquartile band.
  const prices = allPrices.length >= MIN_COMPS_TO_TRIM_TOP
    ? allPrices.slice(0, -1)
    : allPrices

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
