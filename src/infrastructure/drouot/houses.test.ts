import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DROUOT_HOUSES, type DrouotHouse } from './house-configs'
import { isWantedSale } from './is-wanted-sale'
import { parseCataloguePage } from './parse-catalogue-page'
import { parseLotPage } from './parse-lot-page'
import { parseYearPage } from './parse-year-page'
import { toAuctionReference } from './to-auction-reference'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

interface HouseCase {
  house: DrouotHouse
  prefix: string
  /** Sale whose catalogue and lot pages are the fixtures. */
  saleId: string
  keptTitles: string[]
  droppedTitles: string[]
  catalogueTotal: number
  lot: { id: string; number: string; resultEur: number; includesFees: boolean; hammerCents: number; finalCents: number | null }
}

const CASES: HouseCase[] = [
  {
    house: 'OSENAT',
    prefix: 'osenat',
    saleId: '169039',
    keptTitles: ["L'Esprit du XXe siècle", "Mobilier & Objets d'Art", 'Les Intérieurs de Versailles'],
    droppedTitles: ['Vins et spiritueux', 'Montres de collection', 'Vente de Noël Partie 1 : Arts de la table'],
    catalogueTotal: 301,
    lot: { id: '31124241', number: '1', resultEur: 8960, includesFees: true, hammerCents: 700000, finalCents: 896000 },
  },
  {
    house: 'PBA',
    prefix: 'pba',
    saleId: '168549',
    keptTitles: ['Intérieur classique #5', 'Les appartements du XVIe #10', 'Intérieur Contemporain #7'],
    droppedTitles: ['Montres #2', 'Livres, manuscrits & autographes #4', "Arts d'Asie #3 - Catalogue"],
    catalogueTotal: 61,
    lot: { id: '30846455', number: '1', resultEur: 4409, includesFees: true, hammerCents: 339154, finalCents: 440900 },
  },
  {
    house: 'GROS_DELETTREZ',
    prefix: 'gros-delettrez',
    saleId: '168007',
    keptTitles: ['Arts Décoratifs du XXe', "Mobilier et objets d'art", "Tableaux, Mobilier & Objets d'Art"],
    droppedTitles: ['Bijoux anciens & modernes', 'Vins & Spiritueux', 'Horlogerie'],
    catalogueTotal: 237,
    // This 2025 sale is labelled "Résultats sans frais": the label wins over the house default.
    lot: { id: '31295244', number: '1', resultEur: 600, includesFees: false, hammerCents: 60000, finalCents: null },
  },
]

describe.each(CASES)('$house fixtures', ({ house, prefix, saleId, keptTitles, droppedTitles, catalogueTotal, lot: expected }) => {
  const config = DROUOT_HOUSES[house]
  const sales = parseYearPage(fixture(`${prefix}-year.html`))
  const sale = sales.find((s) => s.id === saleId)!

  it('lists the sales of the 2025 year page with ids, titles and dates', () => {
    expect(sales.length).toBeGreaterThan(20)
    expect(sale).toBeDefined()
    expect(sale.date).toMatch(/^2025-\d{2}-\d{2}$/)
    expect(sale.catalogueUrl).toContain(`/catalogue/${saleId}`)
  })

  it('keeps furniture sales and drops jewellery, watch, wine and book sales', () => {
    for (const title of keptTitles) expect(isWantedSale({ title }, config.wantedTitle), title).toBe(true)
    for (const title of droppedTitles) expect(isWantedSale({ title }, config.wantedTitle), title).toBe(false)
    const kept = sales.filter((s) => isWantedSale({ title: s.title }, config.wantedTitle))
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(sales.length)
    expect(kept.map((s) => s.id)).toContain(saleId)
  })

  it('lists 50 lot URLs of the sale from the first catalogue page', () => {
    const page = parseCataloguePage(fixture(`${prefix}-catalogue.html`), saleId)
    expect(page.total).toBe(catalogueTotal)
    expect(page.lotUrls).toHaveLength(50)
    for (const url of page.lotUrls) expect(url).toMatch(new RegExp(`^/lot/${saleId}/\\d+$`))
  })

  it('reads a fee-labelled sold lot and derives the hammer', () => {
    const lot = parseLotPage(fixture(`${prefix}-lot.html`))!
    expect(lot).toMatchObject({ saleId, lotId: expected.id, lotNumber: expected.number, resultEur: expected.resultEur, resultIncludesFees: expected.includesFees })
    expect(lot.photoHashes.length).toBeGreaterThanOrEqual(1)
    const reference = toAuctionReference(lot, sale, config)!
    expect(reference.lot).toMatchObject({
      house,
      saleRef: saleId,
      lotRef: expected.id,
      lotUrl: `${config.baseUrl}/lot/${saleId}/${expected.id}`,
      hammerCents: expected.hammerCents,
      finalCents: expected.finalCents,
    })
    expect(reference.imageUrls.length).toBeGreaterThanOrEqual(1)
  })
})
