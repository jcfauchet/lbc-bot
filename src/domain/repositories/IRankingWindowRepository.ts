/**
 * Tracks, per accrual window (see `windowEntitlement`), whether the comparative
 * ranker has already been consulted. `analyze-and-notify` runs every 15 minutes;
 * without this marker, a window where the ranker declines everything (or picks
 * fewer than the entitlement) gets re-ranked from scratch on every following tick
 * until the window rolls over — repeating the same shortlist build, image fetches
 * and vision call for a near-certainly identical verdict.
 */
export interface IRankingWindowRepository {
  /** Whether the ranker was already consulted for the window identified by `windowKey`. */
  wasRanked(windowKey: string): Promise<boolean>
  /** Records that the ranker was consulted for the window identified by `windowKey`. */
  markRanked(windowKey: string): Promise<void>
}
