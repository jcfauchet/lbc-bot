import { describe, expect, it } from 'vitest'
import { DROUOT_HOUSES } from './house-configs'
import { toAuctionReference } from './to-auction-reference'
import type { DrouotLot, DrouotSale } from './types'

const sale: DrouotSale = { id: '180689', title: 'Mobilier & Objets d\'art', date: '2025-06-12', catalogueUrl: '/catalogue/180689-x' }
const lot = (overrides: Partial<DrouotLot> = {}): DrouotLot => ({
  saleId: '180689', lotId: '34122319', lotNumber: '72', title: 'Commode Louis XV', description: 'Marqueterie',
  estimateLowEur: 800, estimateHighEur: 1200, resultEur: 1300, resultIncludesFees: false,
  photoHostId: '62', photoHashes: [], ...overrides,
})

describe('drouot toAuctionReference', () => {
  it('stores the shown price as the hammer for a result without fees', () => {
    const ref = toAuctionReference(lot(), sale, DROUOT_HOUSES.ROSSINI)!
    expect(ref.lot).toMatchObject({ hammerCents: 130000, finalCents: null })
  })

  it('throws on a fee-inclusive result when the house has no premium rate', () => {
    expect(() => toAuctionReference(lot({ resultIncludesFees: true }), sale, DROUOT_HOUSES.ROSSINI))
      .toThrow('fee-inclusive result but no premium rate configured for ROSSINI')
  })
})
