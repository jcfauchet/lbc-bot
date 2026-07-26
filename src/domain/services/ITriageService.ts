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
  /**
   * The seller's free-text body. Feedback repeatedly asked the triager to "read
   * the description too": it carries age/material/condition cues and replica
   * tells ("dans le style de", "ressemble à") the photo alone cannot show. Used
   * as corroborating signal, not as a source of truth on the piece's value.
   */
  description?: string
}

export interface ITriageService {
  readonly providerName: string
  triage(input: TriageInput, guidance?: string | null): Promise<TriageResult>
}
