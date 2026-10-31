import { UNWANTED_TITLE } from '@/infrastructure/drouot/house-configs'
import { isWantedSale } from '@/infrastructure/drouot/is-wanted-sale'

export const ADER_CONFIG = {
  house: 'ADER',
  /** Site root without a trailing slash. */
  baseUrl: 'https://ader-paris.fr',
  /** Used when a lot page prints no "Frais de vente NN%"; results are always fee-inclusive. */
  defaultPremiumRate: 0.32,
  // Drafted from the 2025/2026 sale titles seen in the recon; the rollout dry run lists the kept
  // sales and the regex is corrected before the real ingest.
  wantedTitle: /xxe|design|arts? décoratifs|mobilier|objets? d.art|intérieur|verre|céramique/i,
  /** Same veto as the Drouot houses: the 2026 dry run kept "Livres Online : … Design …" through "design". */
  unwantedTitle: UNWANTED_TITLE,
} as const

/**
 * Title rule on the NFKC form of the title, so a superscript ordinal ("Côté XXᵉ") reads as "XXe";
 * plus the shared minimum of 5 lots.
 */
export function isWantedAderSale(sale: { title: string; totalLots: number }): boolean {
  return isWantedSale({ title: sale.title.normalize('NFKC'), totalLots: sale.totalLots }, ADER_CONFIG)
}
