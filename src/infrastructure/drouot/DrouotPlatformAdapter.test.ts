import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PageFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import type { HouseSale } from '@/infrastructure/auction/HouseAdapter'
import { DrouotPlatformAdapter } from './DrouotPlatformAdapter'
import { DROUOT_HOUSES } from './house-configs'
import { toAuctionReference } from './to-auction-reference'
import type { DrouotLot, DrouotSale } from './types'

const ROSSINI = DROUOT_HOUSES.ROSSINI

const read = (f: string) => readFileSync(join(__dirname, '__fixtures__', f), 'utf8')
const lotHtml = read('lot-180689-34122319.html')
const page1 = read('catalogue-186362-p1.html')
const page2 = read('catalogue-186362-p2.html')
const NOW = Date.parse('2026-01-15T10:00:00Z')

const card = (id: string, title: string, date: string) => `
<div class="calendrier entry clearfix Vente${id} Etude162" id="${id}">
  <div class="entry-title"><h2>${title}</h2></div>
  <a class="lien_lot" href="/catalogue/${id}-slug">Catalogue</a>
  <div class="bloc_vente_date">${date}</div>
</div>`
const yearHtml = [
  card('180689', 'Mobilier et Objets d&#39;Art', 'mercredi 31 décembre 2025 à 14h00'),
  card('174947', 'Numismatique, Bijoux, Horlogerie et Luxe', 'mercredi 31 décembre 2025 à 14h00'),
  card('190001', 'Design et Intérieurs', 'jeudi 5 mars 2026 à 14h00'),
  card('190002', 'Mobilier sans date', 'a venir'),
].join('\n')

// Third catalogue page: the last 38 lots of 138.
const page3 = `Lots 101 à 138 sur 138 ${Array.from({ length: 38 }, (_, i) => `<a href="/lot/186362/9${100 + i}-x">l</a>`).join('')}`

const catalogueUrl = (id: string, offset: number) => `https://www.rossini.fr/catalogue/${id}?lang=fr&search=&offset=${offset}&max=50`
const YEAR_URL = 'https://www.rossini.fr/resultats?year=2025'
const LOT_URL = 'https://www.rossini.fr/lot/180689/34122319'

function setup(pages: Record<string, string> = {}) {
  const fetched: string[] = []
  const logs: string[] = []
  const fetcher: PageFetcher = {
    fetchText: async (url) => {
      fetched.push(url)
      if (url in pages) return pages[url]
      throw new Error(`unexpected fetch ${url}`)
    },
  }
  return { adapter: new DrouotPlatformAdapter(ROSSINI, fetcher, (l) => logs.push(l), () => NOW), fetched, logs }
}

/** listLotUrls reads only the sale ref. */
const catalogueSale = (ref: string): HouseSale => ({ ref, name: 'x', closedAt: '2025-12-31', finished: true, totalLots: 0 })

const collect = async (sales: AsyncIterable<HouseSale>) => {
  const out: HouseSale[] = []
  for await (const sale of sales) out.push(sale)
  return out
}

describe('DrouotPlatformAdapter (rossini)', () => {
  it('lists only the wanted sales of the year', async () => {
    const { adapter, fetched } = setup({ [YEAR_URL]: yearHtml })
    const sales = await collect(adapter.listSales(2025, {}))
    expect(sales.map((s) => s.ref)).toEqual(['180689', '190001', '190002'])
    expect(sales[0]).toEqual({
      ref: '180689',
      name: "Mobilier et Objets d'Art",
      closedAt: '2025-12-31',
      finished: true,
      totalLots: 0,
      label: "Mobilier et Objets d'Art",
    })
    expect(sales[1].finished).toBe(false)
    expect(sales[2].closedAt).toBeNull()
    expect(sales[2].finished).toBe(false)
    expect(fetched).toEqual([YEAR_URL])
  })

  it('keeps only the asked-for sale', async () => {
    const { adapter } = setup({ [YEAR_URL]: yearHtml })
    const sales = await collect(adapter.listSales(2025, { saleRef: '190001' }))
    expect(sales.map((s) => s.ref)).toEqual(['190001'])
  })

  it('pages the catalogue at offsets 0, 50, 100 for a total of 138', async () => {
    const { adapter, fetched } = setup({
      [catalogueUrl('186362', 0)]: page1,
      [catalogueUrl('186362', 50)]: page2,
      [catalogueUrl('186362', 100)]: page3,
    })
    const urls = await adapter.listLotUrls(catalogueSale('186362'))
    expect(fetched).toEqual([0, 50, 100].map((o) => catalogueUrl('186362', o)))
    expect(urls).toHaveLength(138)
    expect(new Set(urls).size).toBe(138)
    expect(urls[0]).toMatch(/^https:\/\/www\.rossini\.fr\/lot\/186362\/\d+$/)
    expect(adapter.lotRefFromUrl(urls[0])).toMatch(/^\d+$/)
  })

  it('returns no lot URLs for a sale under 5 lots', async () => {
    const small = 'Lots 1 à 3 sur 3 <a href="/lot/1/2">x</a>'
    const { adapter } = setup({ [YEAR_URL]: yearHtml, [catalogueUrl('180689', 0)]: small })
    const [sale] = await collect(adapter.listSales(2025, { saleRef: '180689' }))
    expect(await adapter.listLotUrls(sale)).toEqual([])
  })

  it('throws for a catalogue without a total, so the sale is skipped rather than kept empty', async () => {
    const { adapter } = setup({ [catalogueUrl('180689', 0)]: '<html></html>' })
    await expect(adapter.listLotUrls(catalogueSale('180689'))).rejects.toThrow(/catalogue total not found/)
  })

  it('ignores catalogue links to another sale', async () => {
    const html = `Lots 1 à 6 sur 6 ${[1, 2, 3, 4, 5].map((n) => `<a href="/lot/180689/${n}-x">l</a>`).join('')}<a href="/lot/999/123-x">l</a>`
    const { adapter } = setup({ [catalogueUrl('180689', 0)]: html })
    const urls = await adapter.listLotUrls(catalogueSale('180689'))
    expect(urls).toHaveLength(5)
    expect(urls).not.toContain('https://www.rossini.fr/lot/999/123')
  })

  it('stops paging after 40 catalogue pages whatever the total claims', async () => {
    const fetched: string[] = []
    const logs: string[] = []
    const fetcher: PageFetcher = {
      fetchText: async (url) => {
        fetched.push(url)
        const offset = Number(new URL(url).searchParams.get('offset'))
        return `Lots ${offset + 1} à ${offset + 50} sur 100000 <a href="/lot/180689/${offset + 1}-x">l</a>`
      },
    }
    const adapter = new DrouotPlatformAdapter(ROSSINI, fetcher, (l) => logs.push(l), () => NOW)
    const urls = await adapter.listLotUrls(catalogueSale('180689'))
    expect(fetched).toHaveLength(40)
    expect(urls).toHaveLength(40)
    expect(logs).toEqual(['sale 180689 catalogue capped at 40 pages (total 100000)'])
  })

  it('builds the reference of the RODIN lot', async () => {
    const { adapter } = setup({ [YEAR_URL]: yearHtml, [LOT_URL]: lotHtml })
    const [sale] = await collect(adapter.listSales(2025, { saleRef: '180689' }))
    const result = await adapter.fetchLot(LOT_URL, sale)
    expect(result!.lot.house).toBe('ROSSINI')
    expect(result!.lot.hammerCents).toBe(55500000)
    expect(result!.lot.saleRef).toBe('180689')
    expect(result!.lot.lotRef).toBe('34122319')
    expect(result!.imageUrls).toHaveLength(6)
    for (const url of result!.imageUrls) {
      expect(url).toMatch(/^https:\/\/cdn\.drouot\.com\/d\/lot\/fullHD\/62\/180689\/[0-9a-f]{32}$/)
    }
    expect(result!.note).toMatch(/Adjugé 555000 € le 31\/12\/2025, Rossini Mobilier et Objets d'Art$/)
  })

  it('returns null for a lot without a result', async () => {
    const unsold = lotHtml.replace(/Résultat\s*:\s*<nobr>/, 'Retiré : <nobr>')
    const { adapter } = setup({ [YEAR_URL]: yearHtml, [LOT_URL]: unsold })
    const [sale] = await collect(adapter.listSales(2025, { saleRef: '180689' }))
    expect(await adapter.fetchLot(LOT_URL, sale)).toBeNull()
  })

  it('throws when the lot page belongs to another sale', async () => {
    const otherSaleUrl = 'https://www.rossini.fr/lot/190001/34122319'
    const { adapter } = setup({ [YEAR_URL]: yearHtml, [otherSaleUrl]: lotHtml })
    const [sale] = await collect(adapter.listSales(2025, { saleRef: '190001' }))
    await expect(adapter.fetchLot(otherSaleUrl, sale)).rejects.toThrow(/belongs to sale 180689, not 190001/)
  })

  it('throws for a sale that was not listed', async () => {
    const { adapter } = setup()
    const sale: HouseSale = { ref: '1', name: 'x', closedAt: null, finished: true, totalLots: 0 }
    await expect(adapter.fetchLot('https://www.rossini.fr/lot/1/2', sale)).rejects.toThrow(/not listed/)
  })
})

describe('toAuctionReference (rossini)', () => {
  const sale: DrouotSale = { id: '9', title: 'Design', date: '2025-06-01', catalogueUrl: '/catalogue/9' }
  const lot: DrouotLot = {
    saleId: '9',
    lotId: '5',
    lotNumber: '1',
    title: 'Paire de fauteuils',
    description: 'd'.repeat(500),
    estimateLowEur: 100.5,
    estimateHighEur: 200,
    resultEur: 150.25,
    photoHashes: [],
    resultIncludesFees: false,
    photoHostId: '62',
  }

  it('applies quantity, cents and the 400-char note', () => {
    const ref = toAuctionReference(lot, sale, ROSSINI)!
    expect(ref.lot.quantity).toBe(2)
    expect(ref.lot.hammerCents).toBe(15025)
    expect(ref.lot.hammerPerUnitCents).toBe(7513)
    expect(ref.lot.estimateLowCents).toBe(10050)
    expect(ref.note.startsWith(`${'d'.repeat(400)}\nAdjugé`)).toBe(true)
    expect(ref.keywords).toEqual([])
    expect(ref.lot.artist).toBeNull()
    expect(ref.lot.lotUrl).toBe('https://www.rossini.fr/lot/9/5')
  })

  it('skips unsold lots and sales without a date', () => {
    expect(toAuctionReference({ ...lot, resultEur: null }, sale, ROSSINI)).toBeNull()
    expect(toAuctionReference({ ...lot, resultEur: 0 }, sale, ROSSINI)).toBeNull()
    expect(toAuctionReference(lot, { ...sale, date: null }, ROSSINI)).toBeNull()
  })

  it('builds fullHD photo URLs on the host id read from the page', () => {
    const hash = 'a'.repeat(32)
    const ref = toAuctionReference({ ...lot, photoHashes: [hash], photoHostId: '97' }, sale, ROSSINI)!
    expect(ref.imageUrls).toEqual([`https://cdn.drouot.com/d/lot/fullHD/97/9/${hash}`])
  })
})

describe('toAuctionReference (fee-inclusive results)', () => {
  const osenat = DROUOT_HOUSES.OSENAT
  const sale: DrouotSale = { id: '9', title: 'Mobilier & Objets d’art', date: '2025-06-01', catalogueUrl: '/catalogue/9' }
  const lot: DrouotLot = {
    saleId: '9',
    lotId: '5',
    lotNumber: '1',
    title: 'Commode Louis XV',
    description: '',
    estimateLowEur: null,
    estimateHighEur: null,
    resultEur: 1280,
    photoHashes: [],
    resultIncludesFees: true,
    photoHostId: null,
  }

  it('derives the hammer from a result labelled "avec frais"', () => {
    const ref = toAuctionReference(lot, sale, osenat)!
    expect(ref.lot.house).toBe('OSENAT')
    expect(ref.lot.finalCents).toBe(128_000)
    expect(ref.lot.hammerCents).toBe(100_000)
    expect(ref.lot.hammerPerUnitCents).toBe(100_000)
    expect(ref.lot.lotUrl).toBe('https://www.osenat.com/lot/9/5')
    expect(ref.note).toBe('Résultat 1280 € frais compris (≈ 1000 € au marteau), Osenat Mobilier & Objets d’art')
  })

  it('uses the house default when the lot shows no fees label', () => {
    const ref = toAuctionReference({ ...lot, resultIncludesFees: null }, sale, osenat)!
    expect(ref.lot.finalCents).toBe(128_000)
    expect(ref.lot.hammerCents).toBe(100_000)
  })

  it('keeps the shown price as the hammer for a result labelled "sans frais"', () => {
    const ref = toAuctionReference({ ...lot, resultIncludesFees: false }, sale, osenat)!
    expect(ref.lot.finalCents).toBeNull()
    expect(ref.lot.hammerCents).toBe(128_000)
    expect(ref.note).toBe('Adjugé 1280 € le 01/06/2025, Osenat Mobilier & Objets d’art')
  })

  it('keeps Rossini on hammer prices when the label is absent', () => {
    const ref = toAuctionReference({ ...lot, resultIncludesFees: null }, sale, ROSSINI)!
    expect(ref.lot.finalCents).toBeNull()
    expect(ref.lot.hammerCents).toBe(128_000)
  })
})
