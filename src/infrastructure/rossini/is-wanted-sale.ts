// Furniture / design / interiors. The spec's drop list (numismatique, bijoux, montres, livres,
// affiches, ...) only applies when no kept word is present, and a title with no kept word is
// rejected anyway, so the keep rule alone implements it ("Livres, Timbres, Mobilier, Objets
// d'Art & Arts de la Table" is kept by "mobilier").
const KEPT =
  /mobilier|objets? d.art|intérieurs?|design|classiques de rossini|collections classiques|arts? de la table/i

const MIN_LOTS = 5

export function isWantedSale(sale: { title: string; totalLots?: number }): boolean {
  if (sale.totalLots !== undefined && sale.totalLots < MIN_LOTS) return false
  return KEPT.test(sale.title)
}
