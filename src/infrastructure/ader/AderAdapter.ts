import { HOUSE_LABELS } from '@/domain/auction-houses'
import type { NewAuctionLot } from '@/domain/repositories/IReferenceRepository'
import { ClientError, type PageFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import type { HouseAdapter, HouseSale } from '@/infrastructure/auction/HouseAdapter'
import { parseQuantity } from '@/infrastructure/auction/quantity'
import { feeInclusivePriceLine } from '@/infrastructure/drouot/to-auction-reference'
import { ADER_CONFIG, isWantedAderSale } from './house-config'
import { parseLotPage, type AderLot } from './parse-lot-page'
import { parseLotPaths, parseSalePage, type AderSalePage } from './parse-sale-page'
import { parseSalesSitemap } from './parse-sales-sitemap'

/** 2 000 lots at 50 a page: far above any real sale, it only bounds the fetches when the page keeps changing. */
const MAX_SALE_PAGES = 40
/** Sitemap parts are numbered -01, -02, …; no year comes close to this many. */
const MAX_SITEMAP_PARTS = 20
const NOTE_DESCRIPTION_MAX = 400

interface ListedSale extends AderSalePage {
  /** Sale page URL from the sitemap, paged with ?page=N */
  url: string
}

/**
 * Ader (ader-paris.fr, its own template on the Drouot CDN): the yearly sales sitemap lists the
 * sale pages, each sale page carries its title, date, lot count and 50 lot links per `?page=N`,
 * each lot page its fee-inclusive result and the house's "Frais de vente" rate.
 */
export class AderAdapter implements HouseAdapter {
  readonly house = ADER_CONFIG.house
  /** Sales yielded by the current listSales, with their first page of lot links. */
  private salesById = new Map<string, ListedSale>()

  constructor(
    private readonly fetcher: PageFetcher,
    private readonly log: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  async *listSales(year: number, filter: { saleRef?: string }): AsyncGenerator<HouseSale> {
    this.salesById = new Map()
    const today = new Date(this.now()).toISOString().slice(0, 10)
    for (let part = 1; part <= MAX_SITEMAP_PARTS; part++) {
      const xml = await this.fetchSitemapPart(year, part)
      if (xml === null) return
      for (const entry of parseSalesSitemap(xml)) {
        if (filter.saleRef && entry.id !== filter.saleRef) continue
        const sale = await this.loadSale(entry.id, entry.url)
        if (!sale || !isWantedAderSale(sale)) continue
        this.salesById.set(sale.id, sale)
        yield {
          ref: sale.id,
          name: sale.title,
          closedAt: sale.date,
          finished: sale.date !== null && sale.date <= today,
          totalLots: sale.totalLots,
          label: sale.title,
        }
      }
    }
  }

  async listLotUrls(sale: HouseSale): Promise<string[]> {
    const listed = this.salesById.get(sale.ref)
    if (!listed) throw new Error(`sale ${sale.ref} was not listed`)
    const paths = new Set(listed.lotPaths)
    for (let page = 2; paths.size < listed.totalLots; page++) {
      if (page > MAX_SALE_PAGES) {
        this.log(`sale ${sale.ref} lots capped at ${MAX_SALE_PAGES} pages (${listed.totalLots} lots claimed)`)
        break
      }
      const before = paths.size
      for (const path of parseLotPaths(await this.fetcher.fetchText(`${listed.url}?page=${page}`))) paths.add(path)
      // A page past the last one redirects to the last one: nothing new means the end.
      if (paths.size === before) break
    }
    return [...paths].map((path) => `${ADER_CONFIG.baseUrl}${path}`)
  }

  /** '.../l/35353927-etablissements-galle-…' -> '35353927', the lotRef stored in auction_lots. */
  lotRefFromUrl(url: string): string {
    return /\/l\/(\d+)/.exec(url)?.[1] ?? url
  }

  async fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null> {
    const listed = this.salesById.get(sale.ref)
    if (!listed) throw new Error(`sale ${sale.ref} was not listed`)
    const lot = parseLotPage(await this.fetcher.fetchText(url))
    if (!lot) throw new Error('unparseable lot page')
    if (lot.saleId !== listed.id) throw new Error(`lot page belongs to sale ${lot.saleId}, not ${listed.id}`)
    return toAuctionReference(lot, listed, url)
  }

  /**
   * Null once past the last part (a 4xx). The first part must be read; a later part that fails
   * otherwise is logged and ends the listing, so the sales already listed still get ingested
   * (the ingester reads lots only after the listing) and the rest resume on the next run.
   */
  private async fetchSitemapPart(year: number, part: number): Promise<string | null> {
    const url = `${ADER_CONFIG.baseUrl}/sitemap-sales-past-${year}-fr-${String(part).padStart(2, '0')}.xml`
    try {
      return await this.fetcher.fetchText(url)
    } catch (error) {
      if (part === 1) throw error
      if (!(error instanceof ClientError)) this.log(`sitemap part ${part} of ${year} failed, listing stopped: ${(error as Error).message}`)
      return null
    }
  }

  private async loadSale(id: string, url: string): Promise<ListedSale | null> {
    try {
      const page = parseSalePage(await this.fetcher.fetchText(url))
      if (!page) throw new Error('unparseable sale page')
      if (page.id !== id) throw new Error(`sale page shows sale ${page.id}`)
      return { ...page, url }
    } catch (error) {
      this.log(`sale ${id} skipped: ${(error as Error).message}`)
      return null
    }
  }
}

/** Null when the lot was not sold or the sale date is unknown. Results are fee-inclusive: the hammer is derived. */
function toAuctionReference(lot: AderLot, sale: ListedSale, lotUrl: string): NewAuctionLot | null {
  if (lot.resultEur === null || !(lot.resultEur > 0) || sale.date === null) return null
  const rate = lot.premiumRate ?? ADER_CONFIG.defaultPremiumRate
  const finalCents = Math.round(lot.resultEur * 100)
  const hammerCents = Math.round(finalCents / (1 + rate))
  const quantity = Math.max(1, parseQuantity(lot.title))
  const priceLine = feeInclusivePriceLine(lot.resultEur, hammerCents, HOUSE_LABELS.ADER, sale.title)
  const description = lot.description.slice(0, NOTE_DESCRIPTION_MAX)
  const toCents = (eur: number | null) => (eur === null ? null : Math.round(eur * 100))
  return {
    name: lot.title,
    note: description ? `${description}\n${priceLine}` : priceLine,
    keywords: [],
    imageUrls: lot.photoHostId
      ? lot.photoHashes.map((hash) => `https://cdn.drouot.com/d/lot/fullHD/${lot.photoHostId}/${sale.id}/${hash}`)
      : [],
    lot: {
      house: ADER_CONFIG.house,
      saleRef: sale.id,
      lotRef: lot.lotId,
      lotUrl: lotUrl.split(/[?#]/)[0],
      saleName: sale.title,
      soldAt: new Date(sale.date),
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
