import type { IReferenceRepository } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { PageFetcher } from './ArtcurialFetcher'
import { parseLotPage } from './parse-lot-page'
import { parseSalePage } from './parse-sale-page'
import { parseSitemap } from './parse-sitemap'
import { isWantedSale, toAuctionReference } from './to-auction-reference'
import type { ArtcurialSale } from './types'

export interface IngestOptions {
  year: number
  saleRef?: string
  limit?: number
  dryRun: boolean
  concurrency: number
}

export interface IngestReport {
  salesKept: string[]
  lotsSeen: number
  lotsCreated: number
  lotsSkippedExisting: number
  lotsSkippedUnsold: number
  lotsFailed: number
  imagesEmbedded: number
  imagesFailed: number
}

const PROGRESS_EVERY = 25

interface LotJob { url: string; sale: ArtcurialSale }

/** Turns the sold lots of the wanted Artcurial sales into photo references. All I/O goes through the injected ports. */
export class ArtcurialIngester {
  constructor(
    private readonly fetcher: PageFetcher,
    private readonly repo: IReferenceRepository,
    private readonly embedder: IImageEmbeddingService,
    private readonly log: (line: string) => void,
  ) {}

  async ingest(options: IngestOptions): Promise<IngestReport> {
    const report: IngestReport = {
      salesKept: [], lotsSeen: 0, lotsCreated: 0, lotsSkippedExisting: 0, lotsSkippedUnsold: 0, lotsFailed: 0, imagesEmbedded: 0, imagesFailed: 0,
    }
    const sitemap = await this.fetcher.fetchText(`https://www.artcurial.com/sitemap/sales-${options.year}-fr.xml`)
    const { lotUrlsBySale } = parseSitemap(sitemap)
    const jobs: LotJob[] = []
    for (const [saleRef, lotUrls] of lotUrlsBySale) {
      if (options.saleRef && saleRef !== options.saleRef) continue
      const sale = await this.loadWantedSale(saleRef)
      if (!sale) continue
      report.salesKept.push(saleRef)
      this.log(`kept ${saleRef} ${sale.name} ${sale.totalLots} lots ${sale.specialties.join(',')}`)
      for (const url of lotUrls) jobs.push({ url, sale })
    }
    if (options.dryRun) return report

    const queue = options.limit === undefined ? jobs : jobs.slice(0, options.limit)
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const job = queue[next++]
        report.lotsSeen++
        await this.ingestLot(job, report)
        if (report.lotsSeen % PROGRESS_EVERY === 0) this.log(`progress ${report.lotsSeen}/${queue.length} lots`)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker))
    return report
  }

  private async loadWantedSale(saleRef: string): Promise<ArtcurialSale | null> {
    try {
      const sale = parseSalePage(await this.fetcher.fetchText(`https://www.artcurial.com/ventes/${saleRef}`))
      return sale && isWantedSale(sale) ? sale : null
    } catch (error) {
      this.log(`sale ${saleRef} skipped: ${(error as Error).message}`)
      return null
    }
  }

  private async ingestLot({ url, sale }: LotJob, report: IngestReport): Promise<void> {
    try {
      const lot = parseLotPage(await this.fetcher.fetchText(url))
      const input = lot ? toAuctionReference(lot, sale, url) : null
      if (!input) {
        if (lot) report.lotsSkippedUnsold++
        else report.lotsFailed++
        return
      }
      const created = await this.repo.createAuctionLot(input)
      if (!created) {
        report.lotsSkippedExisting++
        return
      }
      report.lotsCreated++
      for (const image of created.images) {
        try {
          await this.repo.setReferenceImageEmbedding(image.id, await this.embedder.embedImage(image.url))
          report.imagesEmbedded++
        } catch (error) {
          report.imagesFailed++
          this.log(`embedding failed ${image.url}: ${(error as Error).message}`)
        }
      }
    } catch (error) {
      report.lotsFailed++
      this.log(`lot failed ${url}: ${(error as Error).message}`)
    }
  }
}
