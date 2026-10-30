import { describe, expect, it } from 'vitest'
import { isWantedSale, lotImageUrl, toAuctionReference } from './to-auction-reference'
import type { ArtcurialLot, ArtcurialSale } from './types'

const bucket = 'https://storage.googleapis.com/art-fr-maya-prod-inventory/'

function sale(overrides: Partial<ArtcurialSale> = {}): ArtcurialSale {
  return { ref: 'IT6064', name: 'Design', status: 'DONE', totalLots: 303, specialties: ['DESIGN'], beginDate: '2025-06-10T08:00:00.000Z', endDate: '2025-06-10T08:00:00.000Z', ...overrides }
}
function lot(overrides: Partial<ArtcurialLot> = {}): ArtcurialLot {
  return {
    saleRef: 'IT6064', lotRef: '278-a', status: 'SOLD', title: 'Suite de dix chaises mod. PK9 - 1960', description: 'Edition Kold',
    artist: null, artistYears: null, estimateLowEur: 8000, estimateHighEur: 12000, hammerEur: 11000, finalEur: 13000,
    soldAt: '2025-06-10T12:00:00.000Z', pictureUrls: [bucket + 'a'], ...overrides,
  }
}
const url = 'https://www.artcurial.com/ventes/IT6064/lots/278-a'

describe('isWantedSale', () => {
  it('keeps a design sale and drops a hotel inventory, a test sale and a tiny sale', () => {
    expect(isWantedSale(sale({ specialties: ['DESIGN'] }))).toBe(true)
    expect(isWantedSale(sale({ specialties: ['FURNITURE_ART_OBJECTS', 'INVENTORIES'] }))).toBe(false)
    expect(isWantedSale(sale({ specialties: ['DESIGN', 'HOTEL'] }))).toBe(false)
    expect(isWantedSale(sale({ specialties: ['DESIGN'], name: 'Vente TEST' }))).toBe(false)
    expect(isWantedSale(sale({ specialties: ['DESIGN'], totalLots: 4 }))).toBe(false)
    expect(isWantedSale(sale({ specialties: ['OLDMASTER_PAINTINGS'] }))).toBe(false)
  })
})

describe('lotImageUrl', () => {
  it('maps the serving url onto the item-images proxy', () => {
    expect(lotImageUrl(bucket + 'FR/611/x.jpg')).toBe('https://www.artcurial.com/item-images/FR/611/x.jpg?w=1024')
  })
})

describe('toAuctionReference', () => {
  it('builds the reference from a sold lot', () => {
    const ref = toAuctionReference(lot({ artist: 'Poul KJAERHOLM', pictureUrls: ['a', 'b', 'c', 'd'].map((p) => bucket + p) }), sale(), url)!
    expect(ref.name).toBe('Poul KJAERHOLM — Suite de dix chaises mod. PK9 - 1960')
    expect(ref.keywords).toEqual(['poul kjaerholm'])
    expect(ref.imageUrls).toEqual(['a', 'b', 'c', 'd'].map((p) => `https://www.artcurial.com/item-images/${p}?w=1024`))
    expect(ref.lot).toMatchObject({ hammerCents: 1100000, quantity: 10, hammerPerUnitCents: 110000, house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: url, finalCents: 1300000, estimateLowCents: 800000 })
    expect(ref.note).toMatch(/Adjugé 11000 € le \d{2}\/\d{2}\/\d{4}, Artcurial /)
  })
  it('uses the title alone and no keyword when there is no artist', () => {
    const ref = toAuctionReference(lot({ title: 'Lampe', artist: null }), sale(), url)!
    expect(ref.name).toBe('Lampe')
    expect(ref.keywords).toEqual([])
  })
  it('returns null for an unsold lot and for a sold lot without hammer price', () => {
    expect(toAuctionReference(lot({ status: 'UNSOLD' }), sale(), url)).toBeNull()
    expect(toAuctionReference(lot({ hammerEur: null }), sale(), url)).toBeNull()
    expect(toAuctionReference(lot({ hammerEur: 0 }), sale(), url)).toBeNull()
  })
  it('treats a zero quantity as one', () => {
    const ref = toAuctionReference(lot({ title: 'Lot de 0 vases' }), sale(), url)!
    expect(ref.lot.quantity).toBe(1)
    expect(ref.lot.hammerPerUnitCents).toBe(1100000)
  })
  it('falls back to the sale begin date and caps the description at 400 characters', () => {
    const ref = toAuctionReference(lot({ soldAt: null, description: 'x'.repeat(500) }), sale({ name: 'Design Paris' }), url)!
    expect(ref.note).toBe(`${'x'.repeat(400)}\nAdjugé 11000 € le 10/06/2025, Artcurial Design Paris`)
    expect(ref.lot.soldAt.toISOString()).toBe('2025-06-10T08:00:00.000Z')
  })
})
