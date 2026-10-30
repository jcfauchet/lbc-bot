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

class ClientError extends Error {}

/** Fetches SSR pages and sitemaps: per-URL timeout, one retry on 5xx or network error, throws on 4xx. */
export class ArtcurialFetcher implements PageFetcher {
  async fetchText(url: string): Promise<string> {
    try {
      return await this.fetchOnce(url)
    } catch (error) {
      if (error instanceof ClientError) throw error
      return this.fetchOnce(url)
    }
  }

  private async fetchOnce(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMsFor(url)),
    })
    if (res.status >= 400 && res.status < 500) throw new ClientError(`HTTP ${res.status} for ${url}`)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
  }
}
