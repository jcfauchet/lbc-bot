const MIN_LOTS = 5
/** Furniture words that keep a mixed sale ("Livres, Timbres, Mobilier, Objets d'Art") past the veto. */
const NEVER_VETOED = /mobilier|objets? d.art/i

export interface SaleTitleRules {
  /** A sale is kept when its title matches. */
  wantedTitle: RegExp
  /** Vetoes a kept title, unless it names furniture or art objects. */
  unwantedTitle?: RegExp
}

/**
 * A sale is wanted when its title matches the house's keep regex, is not vetoed by its
 * unwanted regex, and it has at least 5 lots (when known).
 */
export function isWantedSale(sale: { title: string; totalLots?: number }, rules: SaleTitleRules): boolean {
  if (sale.totalLots !== undefined && sale.totalLots < MIN_LOTS) return false
  if (!rules.wantedTitle.test(sale.title)) return false
  return !(rules.unwantedTitle?.test(sale.title) && !NEVER_VETOED.test(sale.title))
}
