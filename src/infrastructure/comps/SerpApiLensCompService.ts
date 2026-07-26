import type { ICompService, CompResult, CompMatch } from '@/domain/services/ICompService'
import { isValueDomain } from './value-domains'
import { isMassMarketDomain } from './mass-market-domains'

interface SerpVisualMatch {
  title?: string
  link?: string
  source?: string
  price?: { extracted_value?: number; currency?: string }
}

const CURRENCY_SYMBOL: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP' }

export class SerpApiLensCompService implements ICompService {
  readonly providerName = 'serpapi-google-lens'

  constructor(private readonly apiKey: string) {}

  async findComps(imageUrl: string): Promise<CompResult> {
    const u = new URL('https://serpapi.com/search.json')
    u.searchParams.set('engine', 'google_lens')
    u.searchParams.set('url', imageUrl)
    u.searchParams.set('api_key', this.apiKey)

    const res = await fetch(u)
    const json = (await res.json()) as { error?: string; visual_matches?: SerpVisualMatch[] }
    if (json.error) throw new Error(`SerpAPI: ${json.error}`)

    const matches: CompMatch[] = (json.visual_matches ?? []).map((vm) => {
      const link = vm.link ?? ''
      const source = vm.source ?? ''
      const value = vm.price?.extracted_value
      const rawCurrency = vm.price?.currency ?? ''
      const currency = CURRENCY_SYMBOL[rawCurrency] ?? (rawCurrency || 'EUR')
      return {
        title: vm.title ?? '',
        link,
        source,
        isValueDomain: isValueDomain(`${link} ${source}`),
        isMassMarket: isMassMarketDomain(`${link} ${source}`),
        price: typeof value === 'number' ? { value, currency } : undefined,
      }
    })

    return { matches }
  }
}
