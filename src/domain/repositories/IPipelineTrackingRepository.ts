export type ScrapeOutcome = 'ok' | 'blocked' | 'error'

export interface ScrapeAttemptRecord {
  searchId: string
  outcome: ScrapeOutcome
  newListings: number
  durationMs: number
}

export interface AppraisalRunRecord {
  listingId: string
  compCount: number
  turns: number
  costUsd: number
}

/** Write-only measurements read back by the weekly report. */
export interface IPipelineTrackingRepository {
  recordScrapeAttempt(attempt: ScrapeAttemptRecord): Promise<void>
  recordAppraisalRun(run: AppraisalRunRecord): Promise<void>
}
