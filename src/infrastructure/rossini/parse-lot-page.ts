import { stripHtml } from '../artcurial/parse-lot-page'
import { ROSSINI_HOUSE_ID, type RossiniLot } from './types'

const toNumber = (digits: string): number => Number(digits.replace(/[\s ]/g, ''))

export function parseLotPage(html: string): RossiniLot | null {
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

  const estimate = /estimAff\d*">\s*([\d\s ]+?)\s*-\s*([\d\s ]+?)\s*(?:EUR|<)/.exec(html)
  const result = /Résultat\s*:\s*<nobr>\s*([\d\s ]+?)\s*EUR/.exec(html)

  const photoHashes = new Set<string>()
  const photoPattern = new RegExp(
    `cdn\\.drouot\\.com/d/lot/(?:phare|small)/${ROSSINI_HOUSE_ID}/${saleId}/([0-9a-f]{32})`,
    'g',
  )
  for (const match of html.matchAll(photoPattern)) photoHashes.add(match[1])

  return {
    saleId,
    lotId,
    lotNumber,
    title,
    description,
    estimateLowEur: estimate ? toNumber(estimate[1]) : null,
    estimateHighEur: estimate ? toNumber(estimate[2]) : null,
    resultEur: result ? toNumber(result[1]) : null,
    photoHashes: [...photoHashes],
  }
}
