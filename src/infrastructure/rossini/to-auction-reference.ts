import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import { parseQuantity } from '@/infrastructure/auction/quantity'
import { ROSSINI_HOUSE_ID, type RossiniLot, type RossiniSale } from './types'

const NOTE_DESCRIPTION_MAX = 400

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

const toCents = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100))

/** Null when the lot was not sold or the sale date is unknown (no sold-at date to record). */
export function toAuctionReference(lot: RossiniLot, sale: RossiniSale): NewAuctionLot | null {
  if (lot.resultEur === null || !(lot.resultEur > 0) || sale.date === null) return null
  const hammerCents = Math.round(lot.resultEur * 100)
  const quantity = Math.max(1, parseQuantity(lot.title))
  const soldAt = new Date(sale.date)
  const priceLine = `Adjugé ${lot.resultEur} € le ${formatDate(soldAt)}, Rossini ${sale.title}`
  const description = lot.description.slice(0, NOTE_DESCRIPTION_MAX)
  return {
    name: lot.title,
    note: description ? `${description}\n${priceLine}` : priceLine,
    keywords: [],
    imageUrls: lot.photoHashes.map((hash) => `https://cdn.drouot.com/d/lot/full/${ROSSINI_HOUSE_ID}/${sale.id}/${hash}`),
    lot: {
      house: 'ROSSINI',
      saleRef: sale.id,
      lotRef: lot.lotId,
      lotUrl: `https://www.rossini.fr/lot/${sale.id}/${lot.lotId}`,
      saleName: sale.title,
      soldAt,
      title: lot.title,
      artist: null,
      hammerCents,
      quantity,
      hammerPerUnitCents: Math.round(hammerCents / quantity),
      artistYears: null,
      description: lot.description,
      estimateLowCents: toCents(lot.estimateLowEur),
      estimateHighCents: toCents(lot.estimateHighEur),
      finalCents: null,
    },
  }
}
