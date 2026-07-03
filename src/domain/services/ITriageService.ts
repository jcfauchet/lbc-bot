export interface TriageResult {
  /** 0–10 "worth a Lens call" score. */
  score: number
  rationale?: string
}

export interface TriageInput {
  imageUrl: string
  title: string
  /**
   * Asking price in euros. Feedback data showed a visual-only score does not
   * predict profitability (score-9 listings were 92% rejected by the user):
   * a beautiful piece at a fair price has no hidden margin. The triager needs
   * the price to score margin potential, not just vintage appeal.
   */
  priceEur: number
}

export interface ITriageService {
  readonly providerName: string
  triage(input: TriageInput, guidance?: string | null): Promise<TriageResult>
}
