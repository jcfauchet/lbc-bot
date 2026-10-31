/**
 * Which sold lots belong in the photo-reference fund. The reseller hunts furniture,
 * lighting and decorative objects on Leboncoin; paintings, works on paper, photographs,
 * rugs and clocks never turn into a deal there (her call, 31 Oct 2026), so those lots
 * are kept out of the fund even when the sale itself is a furniture sale.
 */

/** Words that make a lot a keeper whatever else its text says ("Table, plateau peint à l'huile"). */
const KEPT_OBJECT =
  /\b(chaises?|fauteuils?|berg[èe]res?|canap[ée]s?|sofas?|banquettes?|tabourets?|tables?|gu[ée]ridons?|consoles?|bureaux?|secr[ée]taires?|commodes?|buffets?|enfilades?|armoires?|biblioth[èe]ques?|[ée]tag[èe]res?|vitrines?|cabinets?|chevets?|lits?|paravents?|dessertes?|si[èe]ges?|chauffeuses?|m[ée]ridiennes?|semainiers?|bahuts?|cr[ée]dences?|coiffeuses?|bancs?|poufs?|lampes?|lampadaires?|appliques?|suspensions?|lustres?|plafonniers?|lanternes?|miroirs?|vases?|coupes?)\b/i

/** Paintings, works on paper and photographs, read in the title or the start of the description. */
const ARTWORK =
  /\b(huile|toile|gouache|aquarelle|dessin|pastel|lithographie|gravure|estampe|eau-forte|s[ée]rigraphie|photographie|tirage|tableau|fusain|sanguine|technique mixte|encre de chine)\b/i

/** Rugs and clocks, read in the title only (a "tapis de jeu" in a description is a table detail). */
const RUG_OR_CLOCK = /\b(tapis|kilims?|tapisseries?|pendules?|horloges?|cartels?|r[ée]gulateurs?)\b/i

/** Characters of the description read with the title: the medium line of an artwork comes first. */
const DESCRIPTION_HEAD = 200

/** An artist's surname in capitals before his dates ("Bernard BUFFET (1928-1999)") is not an object word. */
const ARTIST_WITH_DATES = /\b[A-ZÀ-Ý][A-ZÀ-Ý'’ -]+\s*\(\s*\d{4}/g

export function isUnwantedLot(lot: { title: string; description?: string | null }): boolean {
  // A clock or a rug first: "Cartel d'applique" is a wall clock, not a light.
  if (RUG_OR_CLOCK.test(lot.title)) return true
  if (KEPT_OBJECT.test(lot.title.replace(ARTIST_WITH_DATES, ' '))) return false
  return ARTWORK.test(`${lot.title} ${(lot.description ?? '').slice(0, DESCRIPTION_HEAD)}`)
}
