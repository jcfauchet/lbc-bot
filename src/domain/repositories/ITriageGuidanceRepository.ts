export interface TriageGuidance {
  id: string
  content: string
  sourceFeedbackCount: number
  createdAt: Date
}

export interface ITriageGuidanceRepository {
  /** Most recently generated guidance, or null if none exists yet. */
  getLatest(): Promise<TriageGuidance | null>
  save(content: string, sourceFeedbackCount: number): Promise<TriageGuidance>
}
