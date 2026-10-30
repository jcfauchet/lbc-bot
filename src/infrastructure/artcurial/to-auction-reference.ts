import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import { parseQuantity } from './quantity'
import type { ArtcurialLot, ArtcurialSale } from './types'

export const WANTED_SPECIALTIES = ['DESIGN', 'ART_DECO', 'ITALIAN_DESIGN', 'FURNITURE_ART_OBJECTS', 'LIMITED_EDITION']
export const EXCLUDED_SPECIALTIES = ['INVENTORIES', 'HOTEL']

const MIN_SALE_LOTS = 5
const NOTE_DESCRIPTION_MAX = 400
const STORAGE_PREFIX = 'https://storage.googleapis.com/art-fr-maya-prod-inventory/'

export function isWantedSale(sale: ArtcurialSale): boolean {
  if (sale.totalLots < MIN_SALE_LOTS) return false
  if (/test/i.test(sale.name)) return false
  if (sale.specialties.some((s) => EXCLUDED_SPECIALTIES.includes(s))) return false
  return sale.specialties.some((s) => WANTED_SPECIALTIES.includes(s))
}

/**
 * Derived from the serving url, not from blobName: on older lots blobName lacks the
 * leading folder ('/611/x.jpg' instead of 'FR/611/x.jpg') and the proxy answers 404.
 */
export function lotImageUrl(servingUrl: string): string {
  const path = servingUrl.startsWith(STORAGE_PREFIX) ? servingUrl.slice(STORAGE_PREFIX.length) : servingUrl
  // fit=inside keeps the longest edge at 1024 px: with w=1024 alone a tall vase photo
  // came back 1024x5563 and was refused by the 3000 px limit of fetch-image.
  return `https://www.artcurial.com/item-images/${path}?w=1024&h=1024&fit=inside`
}

function formatDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getUTCFullYear()}`
}

export function toAuctionReference(lot: ArtcurialLot, sale: ArtcurialSale, lotUrl: string): NewAuctionLot | null {
  if (lot.status !== 'SOLD' || lot.hammerEur === null || !(lot.hammerEur > 0)) return null
  const hammerCents = Math.round(lot.hammerEur * 100)
  const quantity = Math.max(1, parseQuantity(lot.title))
  const soldAt = new Date(lot.soldAt ?? sale.beginDate ?? Date.now())
  const priceLine = `Adjugé ${lot.hammerEur} € le ${formatDate(soldAt)}, Artcurial ${sale.name}`
  const description = lot.description.slice(0, NOTE_DESCRIPTION_MAX)
  const cents = (eur: number | null) => (eur === null ? null : Math.round(eur * 100))
  return {
    name: lot.artist ? `${lot.artist} — ${lot.title}` : lot.title,
    note: description ? `${description}\n${priceLine}` : priceLine,
    keywords: lot.artist ? [lot.artist.toLowerCase()] : [],
    imageUrls: lot.pictureUrls.map(lotImageUrl),
    lot: {
      house: 'ARTCURIAL',
      saleRef: lot.saleRef,
      lotRef: lot.lotRef,
      lotUrl,
      saleName: sale.name,
      soldAt,
      title: lot.title,
      artist: lot.artist,
      hammerCents,
      quantity,
      hammerPerUnitCents: Math.round(hammerCents / quantity),
      artistYears: lot.artistYears,
      description: lot.description,
      estimateLowCents: cents(lot.estimateLowEur),
      estimateHighCents: cents(lot.estimateHighEur),
      finalCents: cents(lot.finalEur),
    },
  }
}
