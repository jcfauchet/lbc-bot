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

/**
 * Minimum gap between two requests to the same site. On 31 Oct 2026 Osenat, PBA and
 * Gros & Delettrez answered 429 to about half the lot pages at 3 in flight; Artcurial
 * never did, so it keeps no gap.
 */
export function minIntervalMsFor(url: string): number {
  return new URL(url).hostname.endsWith('artcurial.com') ? 0 : 1_000
}

/** A 4xx other than 429: permanent, never retried. */
export class ClientError extends Error {}

/** A 429: transient, retried after a pause, and thrown as a plain error if it persists. */
class RateLimitedError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null) {
    super(message)
  }
}

/** Pause before retrying a 429 when the site sends no Retry-After. */
const RATE_LIMIT_PAUSE_MS = 30_000
/** Retries after a 429 before the lot counts as failed (the next run picks it up again). */
const RATE_LIMIT_RETRIES = 2

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null
}

/**
 * Fetches SSR pages and sitemaps for every auction house: per-URL timeout, at most one
 * request per second to a rate-limiting site (shared by every worker of this fetcher),
 * one retry on 5xx or network error, up to two retries after a pause on 429 (Retry-After
 * when given, 30 s otherwise), throws on any other 4xx.
 */
export class ArtcurialFetcher implements PageFetcher {
  /** Earliest time the next request to each host may start. */
  private readonly nextSlot = new Map<string, number>()

  constructor(
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  async fetchText(url: string): Promise<string> {
    for (let rateLimited = 0; ; rateLimited++) {
      try {
        return await this.fetchWithOneRetry(url)
      } catch (error) {
        if (!(error instanceof RateLimitedError) || rateLimited >= RATE_LIMIT_RETRIES) throw error
        await this.sleep(error.retryAfterMs ?? RATE_LIMIT_PAUSE_MS)
      }
    }
  }

  private async fetchWithOneRetry(url: string): Promise<string> {
    try {
      return await this.fetchOnce(url)
    } catch (error) {
      if (error instanceof ClientError || error instanceof RateLimitedError) throw error
      return this.fetchOnce(url)
    }
  }

  /** Reserves the host's next slot synchronously, so concurrent workers queue instead of racing. */
  private async waitTurn(url: string): Promise<void> {
    const interval = minIntervalMsFor(url)
    if (interval === 0) return
    const host = new URL(url).hostname
    const now = this.now()
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0)
    this.nextSlot.set(host, slot + interval)
    if (slot > now) await this.sleep(slot - now)
  }

  private async fetchOnce(url: string): Promise<string> {
    await this.waitTurn(url)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMsFor(url)),
    })
    if (res.status === 429) throw new RateLimitedError(`HTTP 429 for ${url}`, retryAfterMs(res.headers.get('retry-after')))
    if (res.status >= 400 && res.status < 500) throw new ClientError(`HTTP ${res.status} for ${url}`)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
  }
}
