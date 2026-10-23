import { z } from 'zod'
import type { CompMatch } from '@/domain/services/ICompService'
import type { AppraisalInput } from '@/domain/services/IAppraisalAgent'
import type { ProductPage } from '@/infrastructure/comps/product-page-photos'
import { isMassMarketDomain } from '@/infrastructure/comps/mass-market-domains'
import { isConvertibleCurrency } from '@/domain/services/comp-scoring'

/** Ad photos shown up front; matches the comp verifier's COMP_VERIFY_LISTING_PHOTOS. */
export const APPRAISAL_LISTING_PHOTOS = 4
/** Seller text beyond this is mostly shipping and pickup chatter. */
const MAX_DESCRIPTION_CHARS = 600

export const APPRAISAL_SYSTEM_PROMPT = [
  'You are the appraiser of a vintage furniture and lighting reseller in France.',
  'She buys unattributed pieces from private sellers on Leboncoin and resells them. Your job, for one ad, is to find out',
  'what the piece really is and to find listings of the SAME model elsewhere, so that its resale value rests on real comparables.',
  '',
  'Work like an expert:',
  '1. Study the ad photos: form, proportions, materials, joinery, hardware, feet, labels or stamps. Form a hypothesis',
  '   (maker, designer, model, period), or several. When reverse-image search leads are given, compare their thumbnails',
  '   with the ad: most are look-alikes, but the closest ones are worth inspecting, and their titles often name the',
  '   designer or model you can then search for.',
  '2. Search the web for that hypothesis. Vintage dealers and marketplaces are where comparables live: Selency, Pamono,',
  '   1stDibs, Chairish, Vinterior, Proantic, Design Market, Catawiki and auction houses. Search in English and in French.',
  '3. Open promising product pages with inspect_page. It shows you the dealer photos and the price the page publishes.',
  '4. Compare the photos with the ad, detail by detail. If they do not match, revise the hypothesis and search again.',
  '5. Stop when you hold two to four same-model comparables, or when the leads are exhausted.',
  '',
  'Rules:',
  '- A comparable counts only if it shows the SAME model or design (same maker, or a faithful edition), judged on form,',
  '  proportions, materials and construction details. The same kind of object, the same style or a look-alike does NOT',
  '  count: a reseller who buys a look-alike at the price of the real thing loses money. When in doubt, leave it out.',
  '- Only pages you opened with inspect_page can be submitted. Their price is read from the page, never from you.',
  '- New reproductions and mass-market retail are not comparables for a vintage piece.',
  '- Always research before concluding, even when the piece looks generic or unattributed: run at least two searches',
  '  and inspect the most promising candidates. Recognising pieces the seller did not identify is the whole point.',
  '- After that research, "nothing reliable found" is a normal, useful answer. An empty list beats a wrong one.',
  '- Your budget is small: about six searches and eight page inspections. Spend it on the most promising leads.',
  '',
  'Finish by calling submit_appraisal exactly once. Write the identification and notes in English.',
].join('\n')

/** Leads shown to the agent, each with its thumbnail: enough to cover what Lens ranks first. */
export const MAX_APPRAISAL_LEADS = 20

/** The leads worth showing: not the ad itself or other Leboncoin ads, each page once, Lens order kept. */
export function appraisalLeads(leads: CompMatch[] | undefined): CompMatch[] {
  const seen = new Set<string>()
  return (leads ?? [])
    .filter((l) => l.link && !/leboncoin\.fr/i.test(l.link))
    .filter((l) => !seen.has(normalizeUrl(l.link)) && seen.add(normalizeUrl(l.link)))
    .slice(0, MAX_APPRAISAL_LEADS)
}

export function describeLead(lead: CompMatch, n: number): string {
  const retail = lead.isMassMarket ? ' (mass-market retail)' : ''
  return `Lead ${n}: [${lead.source}] ${lead.title}${retail} — ${lead.link}`
}

export function buildAppraisalBrief(input: AppraisalInput): string {
  const description = input.description?.trim()
  return [
    `Ad title: "${input.title}"`,
    `Asking price: ${input.priceEur} €`,
    description ? `Seller description: ${description.slice(0, MAX_DESCRIPTION_CHARS)}` : 'No seller description.',
    'The ad photos follow.',
  ].join('\n')
}

/** What inspect_page tells the agent about one page; photos follow as images. */
export function describeInspectedPage(page: ProductPage | null, photosShown: number): string {
  if (!page) return 'Could not read this page: unreachable, blocked, or redirected (sold items often redirect). Try another lead.'
  return [
    `Page title: ${page.title ?? 'unknown'}`,
    `Published price: ${page.price ? `${page.price.value} ${page.price.currency}` : 'none found on the page (it cannot be used as a priced comparable)'}`,
    photosShown ? `${photosShown} dealer photo(s) follow.` : 'No product photo found on the page.',
  ].join('\n')
}

export const submissionSchema = z.object({
  identification: z.string(),
  same_model_urls: z.array(z.string()),
  notes: z.string(),
})
export type AppraisalSubmission = z.infer<typeof submissionSchema>

/** Same page whatever the fragment or a trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

/**
 * The comparables kept from a submission: only pages the agent actually inspected,
 * with a published price and at least one photo, each counted once. This is the
 * guard against a model that "remembers" a comparable or a price it never saw.
 */
export function acceptedComps(submittedUrls: string[], inspected: Map<string, ProductPage | null>): CompMatch[] {
  const comps: CompMatch[] = []
  const seen = new Set<string>()
  for (const raw of submittedUrls) {
    const key = normalizeUrl(raw)
    const page = inspected.get(key)
    if (!page?.price || !isConvertibleCurrency(page.price.currency) || page.photos.length === 0 || seen.has(key)) continue
    seen.add(key)
    const host = new URL(key).hostname.replace(/^www\./, '')
    comps.push({
      title: page.title ?? host,
      source: host,
      link: key,
      price: page.price,
      photoUrls: page.photos,
      isValueDomain: !isMassMarketDomain(key),
      isMassMarket: isMassMarketDomain(key),
    })
  }
  return comps
}
