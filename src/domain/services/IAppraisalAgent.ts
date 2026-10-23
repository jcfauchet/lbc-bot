import type { CompMatch } from './ICompService'

export interface AppraisalInput {
  title: string
  description?: string | null
  priceEur: number
  /** Every ad photo, cover first. */
  imageUrls: string[]
  /**
   * Reverse-image search results for the cover photo, as starting leads: mostly
   * look-alikes, sometimes the same model, and their titles often name it.
   */
  leads?: CompMatch[]
}

export interface AppraisalCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  webSearches: number
  pagesInspected: number
  turns: number
  usd: number
}

export interface Appraisal {
  /** What the agent believes the piece is ("Brass and lucite coffee table, Charles Hollis Jones style, 1970s"). */
  identification: string
  /**
   * Comparables the agent inspected itself and judged the same model, priced from
   * the dealer page's published price. Empty when nothing reliable was found.
   */
  comps: CompMatch[]
  /** The agent's own account of its search, kept for the eval report and logs. */
  notes: string
  cost: AppraisalCost
}

/**
 * Researches one ad the way an expert would: forms a hypothesis from the photos,
 * searches, opens candidate pages, compares, and revises until it holds same-model
 * comparables or gives up. Pricing stays with comp-scoring: the agent only vouches
 * for which pages show the same piece.
 */
export interface IAppraisalAgent {
  readonly providerName: string
  appraise(input: AppraisalInput): Promise<Appraisal>
}
