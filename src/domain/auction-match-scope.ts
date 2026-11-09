import { categoryOf, postgresPattern, type LotCategory } from './lot-category'

/**
 * Which sold lots an ad is compared with. The fund keeps more than this (it is also
 * browsed), but the first nine days of alerts (1–9 Nov 2026, 12 alerts, none useful)
 * showed what must stay out of the comparison: objects she does not hunt (books,
 * coins, toys, bronzes), lots of several objects priced as a whole, copies, and
 * price gaps so wide that the ad is a lookalike rather than the model.
 */

/** Her searches target furniture, lighting and mirrors. */
export const MATCHED_CATEGORIES = ['FURNITURE', 'LIGHTING', 'MIRRORS'] as const satisfies readonly LotCategory[]

/** "Fort lot de", "Suite de trente-trois", "Ensemble comprenant": a whole lot's price, not one piece's. */
const COLLECTIVE_WORDS = String.raw`^\s*((fort|important|petit|grand)\s+)?(lots?|suite|ensemble|r[ée]union|collection|s[ée]rie|assortiment)\s+(de\s|d['’]|comprenant)`

/** A copy is never the model, on either side. */
const COPY_WORDS = String.raw`(reproductions?|copies?|r[ée]pliques?|fac-?simil[ée]s?)`

const COLLECTIVE = new RegExp(COLLECTIVE_WORDS, 'i')
const COPY = new RegExp(String.raw`(^|[^\p{L}])${COPY_WORDS}($|[^\p{L}])`, 'iu')

export function isCopy(title: string): boolean {
  return COPY.test(title)
}

/**
 * A collective title whose piece count was not read: the hammer covers the whole lot.
 * "Suite de six chaises" is kept, its quantity is 6 and the price is per chair.
 */
export function isUncountedGroup(lot: { title: string; quantity: number }): boolean {
  return lot.quantity === 1 && COLLECTIVE.test(lot.title)
}

export function isMatchableLot(lot: { title: string; description?: string | null; quantity: number }): boolean {
  return (MATCHED_CATEGORIES as readonly LotCategory[]).includes(categoryOf(lot.title, lot.description))
    && !isUncountedGroup(lot)
    && !isCopy(lot.title)
}

/** The same tests as `isMatchableLot`, as PostgreSQL `~*` patterns over the lot's title and description head. */
export const MATCHABLE_LOT_SQL = {
  /** At least one must match `title || ' ' || left(description, DESCRIPTION_HEAD)`. */
  categories: MATCHED_CATEGORIES.map(postgresPattern),
  /** Must not match the title when the quantity is 1. */
  collective: COLLECTIVE_WORDS,
  /** Must not match the title. */
  copy: String.raw`\m${COPY_WORDS}\M`,
}
