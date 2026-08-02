export interface RankingCandidate {
  listingId: string
  imageUrl: string
  title: string
  priceEur: number
  description?: string
}

export interface RankedPick {
  listingId: string
  /** 1-based position in the ranker's ordering; 1 is the best bet. */
  rank: number
  /** The ranker judged this piece worth spending a scarce comp credit on. */
  worthCredit: boolean
  reason?: string
}

/**
 * Orders a shortlist of triage-qualified listings against each other so the few
 * daily comp credits go to the safest bets. Comparative judgement is used because
 * absolute 0-10 triage scoring saturates: 967 of 1651 qualified listings scored
 * exactly 9 over the two weeks to 2 Aug 2026, leaving the choice to freshness alone.
 */
export interface ISelectionRanker {
  readonly providerName: string
  rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]>
}
