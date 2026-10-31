import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClientError, type PageFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import type { HouseSale } from '@/infrastructure/auction/HouseAdapter'
import { AderAdapter } from './AderAdapter'

const read = (f: string) => readFileSync(join(__dirname, '__fixtures__', f), 'utf8')
const salePage1 = read('sale-182231-p1.html')
const lotHtml = read('lot-35353927.html')
const unsoldHtml = read('lot-35353926.html')
const NOW = Date.parse('2026-10-31T10:00:00Z')

const SALE_URL = 'https://ader-paris.fr/v/182231-cote-xx-vente-a-11h00-et-a-14h00'
const LOT_URL = 'https://ader-paris.fr/l/35353927-etablissements-galle-1904-1936-libellule-en-vol-au-dessus'
const UNSOLD_URL = 'https://ader-paris.fr/l/35353926-etablissements-galle-1904-1936-marguerites-flacon-monte'
const sitemapUrl = (year: number, part: number) => `https://ader-paris.fr/sitemap-sales-past-${year}-fr-0${part}.xml`

const sitemap = (urls: string[]) => `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`
const salePage = (id: string, title: string, date: string, lots: number, lotIds: number[] = []) => `
<link rel="canonical" href="/v/${id}-slug">
<h1 class="sale-title">${title}</h1>
<div class="sale-facts"><p>${date}</p><p class="sale-facts-place">Drouot</p></div>
<h2 class="sale-lots-heading">${lots} lots</h2>
${lotIds.map((n) => `<a href="/l/${n}-x" class="lot-card">l</a>`).join('')}`

/** Fetches what `pages` holds; a URL listed in `missing` answers 404, anything else is a test bug. */
function setup(pages: Record<string, string>, missing: string[] = []) {
  const fetched: string[] = []
  const logs: string[] = []
  const fetcher: PageFetcher = {
    fetchText: async (url) => {
      fetched.push(url)
      if (url in pages) return pages[url]
      if (missing.includes(url)) throw new ClientError(`HTTP 404 for ${url}`)
      throw new Error(`unexpected fetch ${url}`)
    },
  }
  return { adapter: new AderAdapter(fetcher, (l) => logs.push(l), () => NOW), fetched, logs }
}

const collect = async (sales: AsyncIterable<HouseSale>) => {
  const out: HouseSale[] = []
  for await (const sale of sales) out.push(sale)
  return out
}

/** The first sale, without reading the following sitemap parts. */
const first = async (sales: AsyncIterable<HouseSale>) => {
  const iterator = sales[Symbol.asyncIterator]()
  const { value } = await iterator.next()
  await iterator.return?.(undefined)
  return value as HouseSale
}

describe('AderAdapter.listSales', () => {
  const yearPages = {
    [sitemapUrl(2026, 1)]: sitemap([SALE_URL, 'https://ader-paris.fr/v/2-vins', 'https://ader-paris.fr/v/3-mini']),
    [sitemapUrl(2026, 2)]: sitemap(['https://ader-paris.fr/v/4-design']),
    [SALE_URL]: salePage1,
    'https://ader-paris.fr/v/2-vins': salePage('2', 'Vins & Spiritueux', 'Mardi 3 mars 2026 à 14h00', 300),
    'https://ader-paris.fr/v/3-mini': salePage('3', 'Mobilier', 'Mardi 3 mars 2026 à 14h00', 4),
    'https://ader-paris.fr/v/4-design': salePage('4', 'Design', 'Jeudi 5 novembre 2026 à 14h00', 80),
  }

  it('reads every sitemap part and keeps the wanted sales of 5 lots or more', async () => {
    const { adapter, fetched } = setup(yearPages, [sitemapUrl(2026, 3)])
    const sales = await collect(adapter.listSales(2026, {}))
    expect(sales.map((s) => s.ref)).toEqual(['182231', '4'])
    expect(sales[0]).toEqual({
      ref: '182231',
      name: 'Côté XXᵉ - Vente à 11h00 et à 14h00',
      closedAt: '2026-10-23',
      finished: true,
      totalLots: 360,
      label: 'Côté XXᵉ - Vente à 11h00 et à 14h00',
    })
    expect(sales[1].finished).toBe(false)
    expect(fetched.at(-1)).toBe(sitemapUrl(2026, 3))
  })

  it('fetches the sale pages lazily, one per asked-for sale', async () => {
    const { adapter, fetched } = setup(yearPages)
    const iterator = adapter.listSales(2026, {})[Symbol.asyncIterator]()
    await iterator.next()
    expect(fetched).toEqual([sitemapUrl(2026, 1), SALE_URL])
    await iterator.return?.(undefined)
  })

  it('fetches only the asked-for sale page', async () => {
    const { adapter, fetched } = setup(yearPages, [sitemapUrl(2026, 3)])
    const sales = await collect(adapter.listSales(2026, { saleRef: '4' }))
    expect(sales.map((s) => s.ref)).toEqual(['4'])
    expect(fetched).toEqual([sitemapUrl(2026, 1), sitemapUrl(2026, 2), 'https://ader-paris.fr/v/4-design', sitemapUrl(2026, 3)])
  })

  it('logs and skips a sale page that fails or does not parse', async () => {
    const { adapter, logs } = setup(
      {
        [sitemapUrl(2026, 1)]: sitemap(['https://ader-paris.fr/v/5-broken', 'https://ader-paris.fr/v/6-gone', 'https://ader-paris.fr/v/4-design']),
        'https://ader-paris.fr/v/5-broken': '<html></html>',
        'https://ader-paris.fr/v/4-design': yearPages['https://ader-paris.fr/v/4-design'],
      },
      ['https://ader-paris.fr/v/6-gone', sitemapUrl(2026, 2)],
    )
    const sales = await collect(adapter.listSales(2026, {}))
    expect(sales.map((s) => s.ref)).toEqual(['4'])
    expect(logs).toEqual(['sale 5 skipped: unparseable sale page', 'sale 6 skipped: HTTP 404 for https://ader-paris.fr/v/6-gone'])
  })

  it('throws when the first sitemap part cannot be read', async () => {
    const { adapter } = setup({}, [sitemapUrl(2026, 1)])
    await expect(collect(adapter.listSales(2026, {}))).rejects.toThrow(/HTTP 404/)
  })

  it('keeps the sales listed so far when a later sitemap part fails', async () => {
    const { adapter, logs } = setup({
      [sitemapUrl(2026, 1)]: sitemap(['https://ader-paris.fr/v/4-design']),
      'https://ader-paris.fr/v/4-design': yearPages['https://ader-paris.fr/v/4-design'],
    })
    const sales = await collect(adapter.listSales(2026, {}))
    expect(sales.map((s) => s.ref)).toEqual(['4'])
    expect(logs).toEqual([`sitemap part 2 of 2026 failed, listing stopped: unexpected fetch ${sitemapUrl(2026, 2)}`])
  })

  it('fetches the sale page of the asked-for 2025 sale only', async () => {
    const page = salePage('161958', 'Côté XXᵉ', 'Jeudi 13 mars 2025 à 14h00', 200)
    const url = 'https://ader-paris.fr/v/161958-cote-xxe'
    const { adapter, fetched } = setup({ [sitemapUrl(2025, 1)]: read('sales-2025.xml'), [url]: page }, [sitemapUrl(2025, 2)])
    const sales = await collect(adapter.listSales(2025, { saleRef: '161958' }))
    expect(sales.map((s) => [s.ref, s.closedAt])).toEqual([['161958', '2025-03-13']])
    expect(fetched).toEqual([sitemapUrl(2025, 1), url, sitemapUrl(2025, 2)])
  })
})

describe('AderAdapter.listLotUrls', () => {
  const lotIds = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)

  it('walks ?page=N from the first page already read, until the lot count is reached', async () => {
    const pages: Record<string, string> = {
      [sitemapUrl(2026, 1)]: sitemap(['https://ader-paris.fr/v/7-design']),
      'https://ader-paris.fr/v/7-design': salePage('7', 'Design', 'Jeudi 1 octobre 2026 à 14h00', 120, lotIds(1, 50)),
      'https://ader-paris.fr/v/7-design?page=2': salePage('7', 'Design', 'x', 120, lotIds(51, 50)),
      'https://ader-paris.fr/v/7-design?page=3': salePage('7', 'Design', 'x', 120, lotIds(101, 20)),
    }
    const { adapter, fetched } = setup(pages)
    const sale = await first(adapter.listSales(2026, { saleRef: '7' }))
    const urls = await adapter.listLotUrls(sale)
    expect(urls).toHaveLength(120)
    expect(urls[0]).toBe('https://ader-paris.fr/l/1-x')
    expect(adapter.lotRefFromUrl(urls[0])).toBe('1')
    expect(fetched.filter((u) => u.includes('?page='))).toEqual([
      'https://ader-paris.fr/v/7-design?page=2',
      'https://ader-paris.fr/v/7-design?page=3',
    ])
  })

  it('stops at a page that brings no new lot (a page past the end redirects to the last one)', async () => {
    const pages: Record<string, string> = {
      [sitemapUrl(2026, 1)]: sitemap(['https://ader-paris.fr/v/8-design']),
      // The heading claims more lots than the pages list.
      'https://ader-paris.fr/v/8-design': salePage('8', 'Design', 'Jeudi 1 octobre 2026 à 14h00', 200, lotIds(1, 50)),
      'https://ader-paris.fr/v/8-design?page=2': salePage('8', 'Design', 'x', 200, lotIds(51, 10)),
      'https://ader-paris.fr/v/8-design?page=3': salePage('8', 'Design', 'x', 200, lotIds(51, 10)),
    }
    const { adapter } = setup(pages)
    const sale = await first(adapter.listSales(2026, { saleRef: '8' }))
    expect(await adapter.listLotUrls(sale)).toHaveLength(60)
  })

  it('stops after 40 pages whatever the lot count claims', async () => {
    const fetched: string[] = []
    const logs: string[] = []
    let next = 1
    const fetcher: PageFetcher = {
      fetchText: async (url) => {
        fetched.push(url)
        if (url.endsWith('.xml')) return sitemap(['https://ader-paris.fr/v/9-design'])
        return salePage('9', 'Design', 'Jeudi 1 octobre 2026 à 14h00', 100000, lotIds((next += 50), 50))
      },
    }
    const adapter = new AderAdapter(fetcher, (l) => logs.push(l), () => NOW)
    const sale = await first(adapter.listSales(2026, { saleRef: '9' }))
    const urls = await adapter.listLotUrls(sale)
    expect(fetched.filter((u) => u.includes('/v/'))).toHaveLength(40)
    expect(urls).toHaveLength(2000)
    expect(logs).toEqual(['sale 9 lots capped at 40 pages (100000 lots claimed)'])
  })

  it('throws for a sale that was not listed', async () => {
    const { adapter } = setup({})
    await expect(adapter.listLotUrls({ ref: '1', name: 'x', closedAt: null, finished: true, totalLots: 9 })).rejects.toThrow(/not listed/)
  })
})

describe('AderAdapter.fetchLot', () => {
  const pages = { [sitemapUrl(2026, 1)]: sitemap([SALE_URL]), [SALE_URL]: salePage1, [LOT_URL]: lotHtml, [UNSOLD_URL]: unsoldHtml }

  it('builds the fee-inclusive reference of the Gallé vase', async () => {
    const { adapter } = setup(pages, [sitemapUrl(2026, 2)])
    const [sale] = await collect(adapter.listSales(2026, { saleRef: '182231' }))
    const ref = (await adapter.fetchLot(LOT_URL, sale))!
    expect(ref.lot).toMatchObject({
      house: 'ADER',
      saleRef: '182231',
      lotRef: '35353927',
      lotUrl: LOT_URL,
      saleName: 'Côté XXᵉ - Vente à 11h00 et à 14h00',
      soldAt: new Date('2026-10-23'),
      finalCents: 145_000,
      // 1 450 € / 1.32
      hammerCents: 109_848,
      hammerPerUnitCents: 109_848,
      quantity: 1,
      estimateLowCents: 60_000,
      estimateHighCents: 80_000,
    })
    expect(ref.imageUrls).toEqual(['https://cdn.drouot.com/d/lot/fullHD/97/182231/7023ba01c810aba6b0e6593d503e2710'])
    expect(ref.name).toMatch(/^ÉTABLISSEMENTS GALLÉ \(1904-1936\) Libellule/)
    expect(ref.note).toMatch(/\nRésultat 1450 € frais compris \(≈ 1098 € au marteau\), Ader Côté XXᵉ - Vente à 11h00 et à 14h00$/)
    expect(adapter.lotRefFromUrl(LOT_URL)).toBe(ref.lot.lotRef)
  })

  it('uses the rate printed on the lot', async () => {
    const { adapter } = setup({ ...pages, [LOT_URL]: lotHtml.replace('>32%<', '>25%<') }, [sitemapUrl(2026, 2)])
    const [sale] = await collect(adapter.listSales(2026, { saleRef: '182231' }))
    expect((await adapter.fetchLot(LOT_URL, sale))!.lot.hammerCents).toBe(116_000)
  })

  it('returns null for an unsold lot', async () => {
    const { adapter } = setup(pages, [sitemapUrl(2026, 2)])
    const [sale] = await collect(adapter.listSales(2026, { saleRef: '182231' }))
    expect(await adapter.fetchLot(UNSOLD_URL, sale)).toBeNull()
  })

  it('throws when the lot page links to another sale', async () => {
    const foreign = lotHtml.replace(/href="\/v\/182231-/g, 'href="/v/999-')
    const { adapter } = setup({ ...pages, [LOT_URL]: foreign }, [sitemapUrl(2026, 2)])
    const [sale] = await collect(adapter.listSales(2026, { saleRef: '182231' }))
    await expect(adapter.fetchLot(LOT_URL, sale)).rejects.toThrow(/belongs to sale 999, not 182231/)
  })

  it('throws for a sale that was not listed', async () => {
    const { adapter } = setup({})
    const sale: HouseSale = { ref: '1', name: 'x', closedAt: null, finished: true, totalLots: 9 }
    await expect(adapter.fetchLot(LOT_URL, sale)).rejects.toThrow(/not listed/)
  })
})
