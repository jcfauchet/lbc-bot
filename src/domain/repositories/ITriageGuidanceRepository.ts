export interface TriageGuidance {
  id: string
  content: string
  sourceFeedbackCount: number
  /**
   * Stable hash of the feedback the guidance was distilled from. Lets the
   * learning routine detect that nothing changed (even when the item count is
   * unchanged, e.g. a comment was edited) and skip a redundant LLM call.
   */
  contentHash: string | null
  createdAt: Date
}

export interface ITriageGuidanceRepository {
  /** Most recently generated guidance, or null if none exists yet. */
  getLatest(): Promise<TriageGuidance | null>
  save(content: string, sourceFeedbackCount: number, contentHash: string): Promise<TriageGuidance>
}
