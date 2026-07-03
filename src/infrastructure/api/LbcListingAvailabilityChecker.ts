import type { IListingAvailabilityService } from '@/domain/services/IListingAvailabilityService'

const REQUEST_TIMEOUT_MS = 5000

/**
 * Best-effort "is this listing still online?" probe against LeBonCoin.
 * LeBonCoin serves 404/410 for removed listings; only those statuses count as
 * gone. A Datadome block (403), 5xx or network error is inconclusive and must
 * not skip the listing — the check exists to save comp credits, not lose deals.
 */
export class LbcListingAvailabilityChecker implements IListingAvailabilityService {
  async isGone(url: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
      })
      return response.status === 404 || response.status === 410
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
