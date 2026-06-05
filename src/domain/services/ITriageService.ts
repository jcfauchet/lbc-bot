export interface TriageResult {
  /** 0–10 "worth a Lens call" score. */
  score: number
  rationale?: string
}

export interface ITriageService {
  readonly providerName: string
  triage(imageUrl: string, title: string): Promise<TriageResult>
}
