import { stripHtml } from '../artcurial/parse-lot-page'
import type { DrouotLot } from './types'

/** CDN size variants a lot page may link; the host id and the hashes are read from the same set. */
const PHOTO_VARIANTS = '(?:phare|small|full|fullHD)'

const toNumber = (digits: string): number => Number(digits.replace(/[\s ]/g, ''))

/** "avec" -> true, "sans" -> false, no label -> null. Read from the lot's result block only. */
function parseFeesLabel(html: string): boolean | null {
  const label = /class="[^"]*\bexplicationResultats\b[^"]*"[^>]*>\s*Résultats?\s+(avec|sans)\s+frais/i.exec(html)?.[1]
  return label === undefined ? null : label.toLowerCase() === 'avec'
}

export function parseLotPage(html: string): DrouotLot | null {
  const lotNumber = /Lot n°\s*(?:&nbsp;)?\s*(\d+[a-zA-Z]?)/.exec(html)?.[1]
  if (!lotNumber) return null
  const ids = /<link rel="canonical" href="[^"]*\/lot\/(\d+)\/(\d+)/.exec(html)
  if (!ids) return null
  const [, saleId, lotId] = ids

  const heading = /<div class="fiche_titre_lot">([\s\S]*?)<\/div>/.exec(html)
  const title = stripHtml(heading?.[1]).replace(/\s*-\s*Lot\s+\S+$/, '')
  const description = stripHtml(
    /<div class="fiche_lot_description"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1],
  )

  const estimate = /estimAff\d*">\s*([\d\s ]+?)\s*-\s*([\d\s ]+?)\s*(?:EUR|<)/.exec(html)
  const result = /Résultat\s*:\s*<nobr>\s*([\d\s ]+?)\s*EUR/.exec(html)

  // The CDN house id comes from the photos of the lot's own sale; ids of other sales
  // (related lots, banners) are ignored.
  const photoHostId =
    new RegExp(`cdn\\.drouot\\.com/d/lot/${PHOTO_VARIANTS}/(\\d+)/${saleId}/[0-9a-f]{32}`).exec(html)?.[1] ?? null
  const photoHashes = new Set<string>()
  if (photoHostId) {
    const photoPattern = new RegExp(
      `cdn\\.drouot\\.com/d/lot/${PHOTO_VARIANTS}/${photoHostId}/${saleId}/([0-9a-f]{32})`,
      'g',
    )
    for (const match of html.matchAll(photoPattern)) photoHashes.add(match[1])
  }

  return {
    saleId,
    lotId,
    lotNumber,
    title,
    description,
    estimateLowEur: estimate ? toNumber(estimate[1]) : null,
    estimateHighEur: estimate ? toNumber(estimate[2]) : null,
    resultEur: result ? toNumber(result[1]) : null,
    resultIncludesFees: parseFeesLabel(html),
    photoHostId,
    photoHashes: [...photoHashes],
  }
}
