// Furniture / design / interiors. The spec's drop list (numismatique, bijoux, montres, livres,
// affiches, ...) only applies when no kept word is present, and a title with no kept word is
// rejected anyway, so the keep rule alone implements it ("Livres, Timbres, Mobilier, Objets
// d'Art & Arts de la Table" is kept by "mobilier").
// "Arts de la table" alone is not kept: on 31 Oct 2026 it matched a wine and spirits
// sale whose cognac bottles became references. Mixed sales still qualify through
// the other words ("Livres, Timbres, Mobilier, Objets d'Art & Arts de la Table").
const KEPT =
  /mobilier|objets? d.art|intérieurs?|design|classiques de rossini|collections classiques/i

const MIN_LOTS = 5

export function isWantedSale(sale: { title: string; totalLots?: number }): boolean {
  if (sale.totalLots !== undefined && sale.totalLots < MIN_LOTS) return false
  return KEPT.test(sale.title)
}
