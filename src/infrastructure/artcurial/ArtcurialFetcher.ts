export interface PageFetcher {
  fetchText(url: string): Promise<string>
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PAGE_TIMEOUT_MS = 15_000
/** A yearly sitemap is ~1 MB and took 19 s on the first production run; a page is ~200 KB in under a second. */
const SITEMAP_TIMEOUT_MS = 90_000

/** Sitemaps get a long timeout; every other Artcurial URL is a single SSR page. */
export function timeoutMsFor(url: string): number {
  return url.includes('/sitemap') ? SITEMAP_TIMEOUT_MS : PAGE_TIMEOUT_MS
}

/** A 4xx other than 429: permanent, never retried. */
export class ClientError extends Error {}

/** A 429: transient, retried once after a pause, and thrown as a plain error if it persists. */
class RateLimitedError extends Error {}

/** Pause before retrying a 429; the Drouot-platform sites rate-limit bursts. */
const RATE_LIMIT_PAUSE_MS = 5_000

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetches SSR pages and sitemaps for every auction house: per-URL timeout, one retry on 5xx
 * or network error, one retry after 5 s on 429, throws on any other 4xx.
 */
export class ArtcurialFetcher implements PageFetcher {
  constructor(private readonly sleep: (ms: number) => Promise<void> = realSleep) {}

  async fetchText(url: string): Promise<string> {
    try {
      return await this.fetchOnce(url)
    } catch (error) {
      if (error instanceof ClientError) throw error
      if (error instanceof RateLimitedError) await this.sleep(RATE_LIMIT_PAUSE_MS)
      return this.fetchOnce(url)
    }
  }

  private async fetchOnce(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMsFor(url)),
    })
    if (res.status === 429) throw new RateLimitedError(`HTTP 429 for ${url}`)
    if (res.status >= 400 && res.status < 500) throw new ClientError(`HTTP ${res.status} for ${url}`)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
  }
}
