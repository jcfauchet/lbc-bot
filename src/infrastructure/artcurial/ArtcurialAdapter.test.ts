import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtcurialAdapter } from './ArtcurialAdapter'
import type { PageFetcher } from './ArtcurialFetcher'

const read = (f: string) => readFileSync(join(__dirname, '__fixtures__', f), 'utf8')
const lotHtml = read('lot-IT6064-278-a.html')
const saleHtml = read('sale-IT6064.html')
const sitemap = read('sitemap-2025-excerpt.xml')
const SITEMAP_URL = 'https://www.artcurial.com/sitemap/sales-2025-fr.xml'
const SALE_URL = 'https://www.artcurial.com/ventes/IT6064'
const LOT_URL = 'https://www.artcurial.com/ventes/IT6064/lots/278-a'
const uniqueLotUrls = [...new Set([...sitemap.matchAll(/<loc>(https:\/\/www\.artcurial\.com\/ventes\/IT6064\/lots\/\d+-[^<]+)<\/loc>/g)].map((m) => m[1]))]

function setup(pages: Record<string, string> = {}) {
  const fetched: string[] = []
  const fetcher: PageFetcher = {
    fetchText: async (url) => {
      fetched.push(url)
      if (url in pages) return pages[url]
      if (url === SITEMAP_URL) return sitemap
      if (url === SALE_URL) return saleHtml
      if (url.includes('/lots/')) return lotHtml
      throw new Error(`HTTP 404 for ${url}`)
    },
  }
  const lines: string[] = []
  return { adapter: new ArtcurialAdapter(fetcher, (l) => lines.push(l)), fetched, lines }
}

describe('ArtcurialAdapter', () => {
  it('is the Artcurial house', () => {
    expect(setup().adapter.house).toBe('ARTCURIAL')
  })
  it('lists the wanted sales of the yearly sitemap with their closing date and status', async () => {
    const { adapter, fetched, lines } = setup()
    const sales = await adapter.listSales(2025)
    expect(fetched[0]).toBe(SITEMAP_URL)
    expect(sales).toEqual([{ ref: 'IT6064', name: expect.any(String), closedAt: '2025-03-18T09:00:00Z', finished: true, totalLots: 303 }])
    // The other sale of the excerpt has no fixture page: it is logged and skipped.
    expect(lines.some((l) => l.startsWith('sale 3895 skipped: '))).toBe(true)
  })
  it('falls back to the begin date and reports a sale still running as not finished', async () => {
    const running = saleHtml.replaceAll('"2025-03-18T09:00:00Z"', 'null').replaceAll('"FINISHED"', '"IN_PROGRESS"')
    const { adapter } = setup({ [SALE_URL]: running })
    const [sale] = await adapter.listSales(2025)
    expect(sale).toMatchObject({ ref: 'IT6064', closedAt: '2025-03-11T13:00:00Z', finished: false })
  })
  it('drops a sale that is not wanted', async () => {
    const { adapter } = setup({ [SALE_URL]: saleHtml.replaceAll('"DESIGN"', '"OLDMASTER_PAINTINGS"').replaceAll('"ART_DECO"', '"MODERN_ART"') })
    expect(await adapter.listSales(2025)).toEqual([])
  })
  it('serves the lot urls of a sale from the sitemap it fetched once', async () => {
    const { adapter, fetched } = setup()
    const [sale] = await adapter.listSales(2025)
    expect(await adapter.listLotUrls(sale)).toEqual(uniqueLotUrls)
    expect(fetched.filter((u) => u === SITEMAP_URL)).toHaveLength(1)
  })
  it('takes the lot ref from the last path segment of the lot url', () => {
    const { adapter } = setup()
    expect(adapter.lotRefFromUrl(LOT_URL)).toBe('278-a')
    expect(adapter.lotRefFromUrl('https://www.artcurial.com/ventes/X/lots/12-%C3%A9')).toBe('12-é')
    expect(adapter.lotRefFromUrl('https://www.artcurial.com/ventes/X/lots/12-%E0')).toBe('12-%E0')
  })
  it('turns the sold PK9 lot page into an auction lot', async () => {
    const { adapter } = setup()
    const [sale] = await adapter.listSales(2025)
    const lot = await adapter.fetchLot(LOT_URL, sale)
    expect(lot?.name).toMatch(/PK9/)
    expect(lot?.imageUrls.length).toBeGreaterThan(0)
    expect(lot?.lot).toMatchObject({ house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', lotUrl: LOT_URL, saleName: sale.name })
    expect(lot?.lot.hammerCents).toBeGreaterThan(0)
  })
  it('returns null for an unsold lot page', async () => {
    const { adapter } = setup({ [LOT_URL]: lotHtml.replace('"SOLD"', '"UNSOLD"') })
    const [sale] = await adapter.listSales(2025)
    expect(await adapter.fetchLot(LOT_URL, sale)).toBeNull()
  })
  it('throws on a lot page it cannot parse', async () => {
    const { adapter } = setup({ [LOT_URL]: '<html></html>' })
    const [sale] = await adapter.listSales(2025)
    await expect(adapter.fetchLot(LOT_URL, sale)).rejects.toThrow(/unparseable lot page/)
  })
})
