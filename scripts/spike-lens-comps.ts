#!/usr/bin/env node
import 'dotenv/config'

/**
 * SPIKE (throwaway): test the funnel hypothesis with Google Lens via SerpAPI.
 *
 * Unlike Vision Web Detection, Google Lens returns visual product matches that
 * often carry PRICES and merchant sources — exactly the "find similar pieces
 * that sold for X" signal we need, without naming a designer.
 *
 * SerpAPI is a third-party that runs Google Lens and returns structured JSON.
 * The image MUST be reachable at a public URL (SerpAPI fetches it Google-side).
 *
 * Usage:
 *   pnpm tsx scripts/spike-lens-comps.ts <publicImageUrl> [moreUrls...]
 */

const API_KEY = process.env.SERPAPI_KEY

// Domains that signal real resale value (auction houses + high-end design marketplaces).
const VALUE_DOMAINS = [
  'selency', '1stdibs', 'pamono', 'design-market', 'drouot', 'interencheres',
  'auction.fr', 'auction', 'catawiki', 'sothebys', 'christies', 'artsy',
  'invaluable', 'chairish', 'noguchi', 'vinterior', 'proantic', 'expertissim',
]

type VisualMatch = {
  position?: number
  title?: string
  link?: string
  source?: string
  price?: { value?: string; extracted_value?: number; currency?: string } | string
  thumbnail?: string
}

function domainOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function isValueSource(m: VisualMatch): boolean {
  const hay = `${m.link ?? ''} ${m.source ?? ''}`.toLowerCase()
  return VALUE_DOMAINS.some((d) => hay.includes(d))
}

function priceString(p: VisualMatch['price']): string | null {
  if (!p) return null
  if (typeof p === 'string') return p
  return p.value ?? (p.extracted_value != null ? `${p.extracted_value} ${p.currency ?? ''}`.trim() : null)
}

function priceNumber(p: VisualMatch['price']): number | null {
  if (!p || typeof p === 'string') return null
  return p.extracted_value ?? null
}

async function lens(imageUrl: string): Promise<VisualMatch[]> {
  const u = new URL('https://serpapi.com/search.json')
  u.searchParams.set('engine', 'google_lens')
  u.searchParams.set('url', imageUrl)
  u.searchParams.set('api_key', API_KEY!)
  const res = await fetch(u)
  const json = await res.json()
  if (json.error) throw new Error(`SerpAPI: ${json.error}`)
  return (json.visual_matches ?? []) as VisualMatch[]
}

function report(imageUrl: string, matches: VisualMatch[]): void {
  console.log('\n' + '='.repeat(80))
  console.log('IMAGE:', imageUrl)
  console.log('='.repeat(80))

  const priced = matches.filter((m) => priceNumber(m.price) != null)
  const valueHits = matches.filter(isValueSource)
  const pricedNums = priced.map((m) => priceNumber(m.price)!).sort((a, b) => a - b)

  console.log(`\n📊 ${matches.length} visual matches | ${priced.length} with a price | ${valueHits.length} on value domains`)

  if (pricedNums.length) {
    const med = pricedNums[Math.floor(pricedNums.length / 2)]
    console.log(`💰 Price range across matches: ${pricedNums[0]} → ${pricedNums[pricedNums.length - 1]} (median ~${med})`)
  }

  console.log('\n⭐ Matches on auction/design value domains:')
  if (!valueHits.length) console.log('   (none)')
  for (const m of valueHits.slice(0, 12)) {
    console.log(`   [${domainOf(m.link) || m.source}] ${priceString(m.price) ?? 'no price'} — ${(m.title ?? '').slice(0, 70)}`)
    console.log(`      ${m.link ?? ''}`)
  }

  console.log('\n🔎 Top priced matches (any source), for context:')
  for (const m of priced.slice(0, 8)) {
    console.log(`   [${domainOf(m.link) || m.source}] ${priceString(m.price)} — ${(m.title ?? '').slice(0, 70)}`)
  }

  const signal = valueHits.length > 0 || priced.length >= 3
  console.log('\n🧪 SPIKE SIGNAL:', signal
    ? `✅ ${valueHits.length} value-domain + ${priced.length} priced matches — usable comps for this item`
    : '❌ no value-domain hits and few/no prices — weak for this item')
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('Missing SERPAPI_KEY in .env')
    process.exit(1)
  }
  const urls = process.argv.slice(2)
  if (!urls.length) {
    console.error('Usage: pnpm tsx scripts/spike-lens-comps.ts <publicImageUrl> [more...]')
    process.exit(1)
  }
  for (const url of urls) {
    try {
      const matches = await lens(url)
      report(url, matches)
    } catch (err) {
      console.error(`\n❌ Failed on ${url}:`, (err as Error).message)
    }
  }
}

main()
