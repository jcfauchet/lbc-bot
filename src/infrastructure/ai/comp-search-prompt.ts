import type { CompContext, CompMatch } from '@/domain/services/ICompService'
import { isValueDomain } from '@/infrastructure/comps/value-domains'
import { isMassMarketDomain } from '@/infrastructure/comps/mass-market-domains'

export function buildCompSearchPrompt(context: CompContext): string {
  return [
    'You help a vintage furniture reseller price a piece she found on a French classifieds site.',
    'The image is the ad photo. Identify the piece (designer, maker, model, period) as precisely as the photo and text allow.',
    `Ad title: "${context.title}"`,
    context.description ? `Ad description: ${context.description.slice(0, 1500)}` : '',
    `Asking price: ${context.priceEur} EUR.`,
    'Use Google Search to find the SAME model (or the closest faithful edition) for sale or sold on dealer and auction sites:',
    'Selency, Pamono, 1stDibs, Design Market, Vinterior, Chairish, Proantic, Catawiki, Drouot, Interencheres, eBay sold listings.',
    'Prefer realised auction prices and dealer listings in Europe. Skip mass-market retail look-alikes (Amazon, Maisons du Monde, IKEA...).',
    'Reply with strict JSON only, up to 10 entries, most relevant first:',
    '{"identification": "<one line>", "comps": [{"title": "<listing title>", "link": "<url>", "priceEur": <number or null>, "status": "sold" | "listed"}]}',
    'Use the exact URL of each page you found. If a price is in another currency, convert it to EUR. Never invent a comparable.',
  ].filter(Boolean).join('\n')
}

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Anything short of a JSON object with a `comps` array yields no matches, like a dry Lens search. */
export function parseCompSearchResult(raw: string): CompMatch[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  const comps = (parsed as { comps?: unknown })?.comps
  if (!Array.isArray(comps)) return []

  const matches: CompMatch[] = []
  for (const entry of comps) {
    const item = entry as { title?: unknown; link?: unknown; priceEur?: unknown }
    const link = typeof item.link === 'string' ? item.link : ''
    const source = hostOf(link)
    if (!source) continue
    const haystack = `${link} ${source}`
    matches.push({
      title: typeof item.title === 'string' ? item.title : '',
      link,
      source,
      isValueDomain: isValueDomain(haystack),
      isMassMarket: isMassMarketDomain(haystack),
      price: typeof item.priceEur === 'number' && item.priceEur > 0 ? { value: item.priceEur, currency: 'EUR' } : undefined,
    })
  }
  return matches
}
