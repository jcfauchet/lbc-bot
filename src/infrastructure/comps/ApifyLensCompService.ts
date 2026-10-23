import type { ICompService, CompResult, CompMatch } from '@/domain/services/ICompService'
import { isValueDomain } from './value-domains'
import { isMassMarketDomain } from './mass-market-domains'

interface ApifyVisualMatch {
  title?: string
  link?: string
  source?: string
  thumbnail?: string
  imageUrl?: string
}

const ACTOR = 'gio21~google-lens-scraper'
/** One Lens search takes 30-60 s on the actor; past this the run is abandoned. */
const RUN_TIMEOUT_SECONDS = 180
/** Each run is charged, so a retry is worth it once, not indefinitely. */
const MAX_RUNS = 2

/**
 * Google Lens visual matches through an Apify scraper actor: several times more
 * searches per dollar than SerpApi, which caps the comp stage at 8 ads a day.
 * Unlike SerpApi it returns no prices; a caller that needs them reads them from
 * the matched product pages (fetchProductPage).
 */
export class ApifyLensCompService implements ICompService {
  readonly providerName = 'apify-google-lens'

  constructor(private readonly token: string) {}

  async findComps(imageUrl: string): Promise<CompResult> {
    let item: { visualMatches?: ApifyVisualMatch[] } | undefined
    // The actor's browser session is refused by Google part of the time, which
    // fails the whole run; a second run usually goes through.
    for (let attempt = 1; ; attempt++) {
      try {
        item = await this.run(imageUrl)
        break
      } catch (err) {
        if (attempt >= MAX_RUNS || (err as { retryable?: boolean }).retryable === false) throw err
      }
    }

    const matches: CompMatch[] = (item.visualMatches ?? []).map((vm) => {
      const link = vm.link ?? ''
      const source = vm.source ?? ''
      return {
        title: vm.title ?? '',
        link,
        source,
        isValueDomain: isValueDomain(`${link} ${source}`),
        isMassMarket: isMassMarketDomain(`${link} ${source}`),
        // The thumbnail is what SerpApi provides too; the full-size image is only
        // fetched by whoever needs to look closely.
        imageUrl: vm.thumbnail || vm.imageUrl || undefined,
        photoUrls: vm.imageUrl ? [vm.imageUrl] : undefined,
      }
    })
    return { matches }
  }

  private async run(imageUrl: string): Promise<{ visualMatches?: ApifyVisualMatch[] }> {
    const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECONDS}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ imageUrls: [imageUrl], country: 'FR', language: 'fr' }),
      signal: AbortSignal.timeout((RUN_TIMEOUT_SECONDS + 20) * 1000),
    })
    if (!res.ok) {
      // 401/402/403: bad token or spent credits, which a retry cannot fix.
      throw Object.assign(new Error(`Apify Lens ${res.status}: ${(await res.text()).slice(0, 200)}`), { retryable: ![401, 402, 403].includes(res.status) })
    }
    const [item] = (await res.json()) as Array<{ visualMatches?: ApifyVisualMatch[] }>
    if (!item) throw new Error('Apify Lens returned no result for the image')
    return item
  }
}
