import { HOUSE_LABELS } from '@/domain/auction-houses'
import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import { parseQuantity } from '@/infrastructure/auction/quantity'
import type { DrouotHouseConfig } from './house-configs'
import type { DrouotLot, DrouotSale } from './types'

const NOTE_DESCRIPTION_MAX = 400

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

const toCents = (eur: number | null): number | null => (eur === null ? null : Math.round(eur * 100))

/** Note line of a fee-inclusive result: the published price as published, then the derived hammer. */
export function feeInclusivePriceLine(resultEur: number, hammerCents: number, houseLabel: string, saleTitle: string): string {
  return `Résultat ${resultEur} € frais compris (≈ ${Math.round(hammerCents / 100)} € au marteau), ${houseLabel} ${saleTitle}`
}

/**
 * Null when the lot was not sold or the sale date is unknown (no sold-at date to record).
 * A fee-inclusive result is stored as finalCents and the hammer is derived with the house's
 * premium rate; the lot's own label wins over the house default.
 */
export function toAuctionReference(lot: DrouotLot, sale: DrouotSale, config: DrouotHouseConfig): NewAuctionLot | null {
  if (lot.resultEur === null || !(lot.resultEur > 0) || sale.date === null) return null
  const label = HOUSE_LABELS[config.house]
  const soldAt = new Date(sale.date)
  const includesFees = lot.resultIncludesFees ?? config.resultIncludesFeesByDefault
  const shownCents = Math.round(lot.resultEur * 100)
  const finalCents = includesFees ? shownCents : null
  const hammerCents = includesFees ? Math.round(shownCents / (1 + config.premiumRate)) : shownCents
  const quantity = Math.max(1, parseQuantity(lot.title))
  const priceLine = includesFees
    ? feeInclusivePriceLine(lot.resultEur, hammerCents, label, sale.title)
    : `Adjugé ${lot.resultEur} € le ${formatDate(soldAt)}, ${label} ${sale.title}`
  const description = lot.description.slice(0, NOTE_DESCRIPTION_MAX)
  return {
    name: lot.title,
    note: description ? `${description}\n${priceLine}` : priceLine,
    keywords: [],
    imageUrls: lot.photoHostId
      ? lot.photoHashes.map((hash) => `https://cdn.drouot.com/d/lot/fullHD/${lot.photoHostId}/${sale.id}/${hash}`)
      : [],
    lot: {
      house: config.house,
      saleRef: sale.id,
      lotRef: lot.lotId,
      lotUrl: `${config.baseUrl}/lot/${sale.id}/${lot.lotId}`,
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
      finalCents,
    },
  }
}
