import { stripHtml } from '@/infrastructure/artcurial/parse-lot-page'

export interface AderLot {
  lotId: string
  /** Sale the page links back to (`href="/v/<id>-…"`) */
  saleId: string
  lotNumber: string
  /** First two lines of the heading (artist or maker, then the object) */
  title: string
  description: string
  estimateLowEur: number | null
  estimateHighEur: number | null
  /** Fee-inclusive price on the "Résultat" box; null when the lot is unsold ("Non communiqué" or no box) */
  resultEur: number | null
  /** From "Frais de vente 32%" -> 0.32; null when not printed */
  premiumRate: number | null
  /** CDN house id of the photos of the lot's own sale; null when none */
  photoHostId: string | null
  /** From cdn.drouot.com/d/lot/fullHD/<photoHostId>/<saleId>/<hash>, own sale only, deduplicated */
  photoHashes: string[]
}

const TITLE_LINES = 2
const TITLE_MAX = 200

const toNumber = (digits: string): number => Number(digits.replace(/\s/g, ''))

/** Value of the info box whose label is `label` ("Estimation", "Résultat", "Frais de vente"). */
function boxValue(html: string, label: string): string | null {
  const match = new RegExp(
    `class="lot-info-box-label">\\s*${label}\\s*</div>\\s*<div class="lot-info-box-value">([\\s\\S]*?)</div>`,
  ).exec(html)
  return match ? stripHtml(match[1]) : null
}

function headingTitle(heading: string): string {
  const lines = heading.split(/\n|<br\s*\/?>/).map((line) => stripHtml(line)).filter(Boolean)
  const title = lines.slice(0, TITLE_LINES).join(' ')
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title
}

/** Null when the page has no lot id, lot number or sale link (not a lot page, or markup drift). */
export function parseLotPage(html: string): AderLot | null {
  const lotId = /<link rel="canonical" href="[^"]*\/l\/(\d+)/.exec(html)?.[1]
  const lotNumber = /Lot n°\s*(?:&nbsp;)?\s*(\d+[a-zA-Z]*)/.exec(html)?.[1]
  // The sale box link first; any sale link otherwise.
  const saleId =
    /class="lot-info-sale-title">\s*<a href="\/v\/(\d+)-/.exec(html)?.[1] ?? /href="\/v\/(\d+)-/.exec(html)?.[1]
  if (!lotId || !lotNumber || !saleId) return null

  const heading = /<h1 class="lot-info-title"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ''
  const description = stripHtml(/data-lot-description-text>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? heading)

  const estimate = /([\d\s]+?)\s*€\s*-\s*([\d\s]+?)\s*€/.exec(boxValue(html, 'Estimation') ?? '')
  const result = /^([\d\s]+?)\s*€$/.exec(boxValue(html, 'Résultat') ?? '')
  const rate = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(boxValue(html, 'Frais de vente') ?? '')

  const photoHostId =
    new RegExp(`cdn\\.drouot\\.com/d/lot/fullHD/(\\d+)/${saleId}/[0-9a-f]{32}`).exec(html)?.[1] ?? null
  const photoHashes = new Set<string>()
  if (photoHostId) {
    const pattern = new RegExp(`cdn\\.drouot\\.com/d/lot/fullHD/${photoHostId}/${saleId}/([0-9a-f]{32})`, 'g')
    for (const match of html.matchAll(pattern)) photoHashes.add(match[1])
  }

  return {
    lotId,
    saleId,
    lotNumber,
    title: headingTitle(heading),
    description,
    estimateLowEur: estimate ? toNumber(estimate[1]) : null,
    estimateHighEur: estimate ? toNumber(estimate[2]) : null,
    resultEur: result ? toNumber(result[1]) : null,
    premiumRate: rate ? Number(rate[1].replace(',', '.')) / 100 : null,
    photoHostId,
    photoHashes: [...photoHashes],
  }
}
