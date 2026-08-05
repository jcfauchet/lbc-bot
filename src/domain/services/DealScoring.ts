/**
 * Deal scoring, derived from a backtest over the 240 human judgements in base
 * (54 good / 186 bad, 22.5% base rate).
 *
 * What the backtest established:
 *   - Ranking by the median `margin` scored AUC 0.298 (0.5 = random). The signal
 *     is not weak, it is INVERTED: high estimated margins come from hallucinated
 *     comps, not from good deals. Precision@25% was 12.5% vs 24.8% for a coin flip.
 *   - The estimate band width separates cleanly: good finds average a 1.71x
 *     max/min ratio, bad finds 4.39x.
 *   - The comp source is the single strongest separator: luxury asking-price
 *     marketplaces back 42% of bad finds but only 19% of good ones, while French
 *     resale sources back 61% of good finds against 43% of bad ones.
 *   - `confidence` is inert (0.872 vs 0.870) and `priceCents` does not separate
 *     at all (210 EUR vs 207 EUR) — neither belongs in the score.
 *
 * The score therefore rewards trustworthy evidence, never a big headline number.
 */

export enum CompSource {
  /** Asking prices on high-end marketplaces — systematically over-estimates. */
  LUXURY = 'luxury',
  /** French resale venues — closer to what a piece actually changes hands for. */
  RESALE = 'resale',
  UNKNOWN = 'unknown',
}

const LUXURY_PATTERN = /1stdibs|chairish|pamono|invaluable|lot-art|liveauctioneers/i
const RESALE_PATTERN = /selency|proantic|leboncoin|brocantelab/i

export interface EstimateInput {
  priceCents: number
  estMinCents: number
  estMaxCents: number
  bestMatchSource: string | null | undefined
}

export interface TrustOptions {
  /** Reject bands wider than this max/min ratio. Good finds sit at ~1.7x. */
  maxRangeRatio?: number
  /** Floor on (estMin - price): the margin that survives the worst realistic resale. */
  minConservativeMarginCents?: number
}

export const DEFAULT_MAX_RANGE_RATIO = 2.5
export const DEFAULT_MIN_CONSERVATIVE_MARGIN_CENTS = 0

/** Width of the estimate band. Infinity when the low end is non-positive. */
export function estimateRangeRatio(estMinCents: number, estMaxCents: number): number {
  if (estMinCents <= 0) return Number.POSITIVE_INFINITY
  return estMaxCents / estMinCents
}

export function classifyCompSource(source: string | null | undefined): CompSource {
  if (!source) return CompSource.UNKNOWN
  if (LUXURY_PATTERN.test(source)) return CompSource.LUXURY
  if (RESALE_PATTERN.test(source)) return CompSource.RESALE
  return CompSource.UNKNOWN
}

/** The margin that holds even at the low end of the band. */
export function conservativeMarginCents(input: EstimateInput): number {
  return input.estMinCents - input.priceCents
}

/**
 * Gate an estimate before it is allowed to reach a human.
 * A band that spans a factor of 20 is not an estimate, it is noise.
 */
export function isEstimateTrustworthy(
  input: EstimateInput,
  options: TrustOptions = {}
): boolean {
  const maxRangeRatio = options.maxRangeRatio ?? DEFAULT_MAX_RANGE_RATIO
  const minConservative =
    options.minConservativeMarginCents ?? DEFAULT_MIN_CONSERVATIVE_MARGIN_CENTS

  if (estimateRangeRatio(input.estMinCents, input.estMaxCents) > maxRangeRatio) return false
  if (conservativeMarginCents(input) < minConservative) return false
  return true
}

/**
 * Ranking score — higher is better. Deliberately built from evidence quality
 * rather than from the size of the estimate, because the backtest showed the
 * latter to be anti-correlated with a good find.
 */
export function computeDealScore(input: EstimateInput): number {
  const ratio = estimateRangeRatio(input.estMinCents, input.estMaxCents)

  // Tight bands score near 1, a 2.5x band scores 0.4, anything wilder tends to 0.
  const tightness = Number.isFinite(ratio) ? 1 / Math.max(1, ratio) : 0

  // Evidence quality: where the comparable came from.
  const sourceWeight = {
    [CompSource.RESALE]: 1,
    [CompSource.UNKNOWN]: 0.4,
    [CompSource.LUXURY]: 0,
  }[classifyCompSource(input.bestMatchSource)]

  // Plausibility: an estimate an order of magnitude above the asking price is a
  // hallucination signature, not an opportunity. Penalise the multiple, never
  // reward it.
  const multiple =
    input.priceCents > 0 ? input.estMinCents / input.priceCents : Number.POSITIVE_INFINITY
  const plausibility = Number.isFinite(multiple) ? 1 / Math.max(1, multiple / 3) : 0

  return 0.45 * tightness + 0.4 * sourceWeight + 0.15 * plausibility
}
