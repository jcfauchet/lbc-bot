const MIN_LOTS = 5

/** A sale is wanted when its title matches the house's keep regex and it has at least 5 lots (when known). */
export function isWantedSale(sale: { title: string; totalLots?: number }, wantedTitle: RegExp): boolean {
  if (sale.totalLots !== undefined && sale.totalLots < MIN_LOTS) return false
  return wantedTitle.test(sale.title)
}
