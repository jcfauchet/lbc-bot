/**
 * Object families of auction lots, read from the lot title. The word lists are written once
 * and turned into a JS regex (display) and a PostgreSQL regex (filtering in the database).
 */
export type LotCategory = 'FURNITURE' | 'LIGHTING' | 'MIRRORS' | 'GLASS_CERAMICS' | 'SCULPTURE' | 'SILVER' | 'OTHER'

const WORDS: Record<Exclude<LotCategory, 'OTHER'>, string> = {
  FURNITURE:
    'chaises?|fauteuils?|berg[èe]res?|canap[ée]s?|sofas?|banquettes?|tabourets?|tables?|gu[ée]ridons?|consoles?|bureaux?|secr[ée]taires?|commodes?|buffets?|enfilades?|armoires?|biblioth[èe]ques?|[ée]tag[èe]res?|vitrines?|cabinets?|chevets?|lits?|paravents?|dessertes?|si[èe]ges?|chauffeuses?|m[ée]ridiennes?|semainiers?|bahuts?|cr[ée]dences?|coiffeuses?|bancs?|poufs?|meubles?',
  LIGHTING: 'lampes?|lampadaires?|appliques?|suspensions?|lustres?|plafonniers?|lanternes?|bougeoirs?|chandeliers?|flambeaux|cand[ée]labres?|liseuses?',
  MIRRORS: 'miroirs?|glaces?',
  GLASS_CERAMICS: 'vases?|coupes?|fa[ïi]ences?|porcelaines?|c[ée]ramiques?|gr[èe]s|verres?|cristal|plats?|assiettes?|services?|pichets?|bouteilles?|flacons?|jardini[èe]res?|cache-pots?|potiches?',
  SCULPTURE: 'sculptures?|bronzes?|bustes?|statuettes?|statues?|terres? cuites?|marbres?|pl[âa]tres?',
  SILVER: 'argent|vermeil|orf[èe]vrerie|couverts?|m[ée]nag[èe]res?|plateaux?|th[ée]i[èe]res?|cafeti[èe]res?|timbales?|sauci[èe]res?|aigui[èe]res?',
}

/** Order of precedence when a title names several families ("Table, plateau en marbre" is furniture). */
export const LOT_CATEGORIES: LotCategory[] = ['FURNITURE', 'LIGHTING', 'MIRRORS', 'GLASS_CERAMICS', 'SCULPTURE', 'SILVER', 'OTHER']

export const LOT_CATEGORY_LABELS: Record<LotCategory, string> = {
  FURNITURE: 'Mobilier',
  LIGHTING: 'Luminaires',
  MIRRORS: 'Miroirs',
  GLASS_CERAMICS: 'Verre & céramique',
  SCULPTURE: 'Sculptures & bronzes',
  SILVER: 'Orfèvrerie',
  OTHER: 'Autres',
}

const JS: Record<Exclude<LotCategory, 'OTHER'>, RegExp> = Object.fromEntries(
  // Letter-aware bounds, like PostgreSQL's \m \M: JS \b sees no word end after "canapé".
  Object.entries(WORDS).map(([k, w]) => [k, new RegExp(`(?<![\\p{L}\\p{N}_])(?:${w})(?![\\p{L}\\p{N}_])`, 'iu')]),
) as Record<Exclude<LotCategory, 'OTHER'>, RegExp>

/** Characters of the description read with the title: short titles ("Edmond LACHENAL (1855-1930)") name the object there. */
export const DESCRIPTION_HEAD = 150

/** The first family, in precedence order, named in the title or the start of the description (same text as the SQL filter). */
export function categoryOf(title: string, description?: string | null): LotCategory {
  const text = `${title} ${(description ?? '').slice(0, DESCRIPTION_HEAD)}`
  return LOT_CATEGORIES.find((c) => c !== 'OTHER' && JS[c].test(text)) ?? 'OTHER'
}

/** PostgreSQL case-insensitive pattern (`~*`) matching a title of this family, word-bounded. */
export function postgresPattern(category: Exclude<LotCategory, 'OTHER'>): string {
  return `\\m(${WORDS[category]})\\M`
}

/**
 * The SQL test for "this title belongs to `category`" under the same precedence as
 * `categoryOf`: it matches the family's words and none of the families before it.
 */
export function categorySqlConditions(category: LotCategory): { matches: string[]; excludes: string[] } {
  const index = LOT_CATEGORIES.indexOf(category)
  const before = LOT_CATEGORIES.slice(0, index).filter((c): c is Exclude<LotCategory, 'OTHER'> => c !== 'OTHER')
  if (category === 'OTHER') {
    return { matches: [], excludes: LOT_CATEGORIES.filter((c): c is Exclude<LotCategory, 'OTHER'> => c !== 'OTHER').map(postgresPattern) }
  }
  return { matches: [postgresPattern(category)], excludes: before.map(postgresPattern) }
}
