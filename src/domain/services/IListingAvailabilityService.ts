export interface IListingAvailabilityService {
  /**
   * Returns true only when the listing is DEFINITELY gone (sold/removed).
   * Any ambiguity (anti-bot block, network error, timeout) must return false:
   * this check exists to save paid comp credits, never to drop live deals.
   */
  isGone(url: string): Promise<boolean>
}
