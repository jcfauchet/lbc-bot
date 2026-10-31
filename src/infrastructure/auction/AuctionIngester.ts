import type { AuctionHouse } from '@/domain/auction-houses'
import type { IReferenceRepository } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import type { HouseAdapter, HouseSale } from './HouseAdapter'

export interface IngestOptions {
  year: number
  saleRef?: string
  limit?: number
  dryRun: boolean
  concurrency: number
  /**
   * Keeps only finished sales whose closing date falls in
   * [now - maxAgeDays, now - minAgeDays]; sales without a date are skipped.
   */
  closedBetween?: { minAgeDays: number; maxAgeDays: number }
  /** Stops starting new lots once this many milliseconds have elapsed. */
  maxRunMs?: number
}

export interface IngestReport {
  house: AuctionHouse
  salesKept: string[]
  /** Sales whose lot list could not be read; they are not in salesKept. */
  salesFailed: number
  lotsSeen: number
  lotsCreated: number
  lotsSkippedExisting: number
  lotsSkippedUnsold: number
  lotsFailed: number
  imagesEmbedded: number
  imagesFailed: number
  stoppedByBudget: boolean
}

const PROGRESS_EVERY = 25
const DAY_MS = 86_400_000

interface LotJob { url: string; sale: HouseSale }

/** Turns the sold lots of one auction house's wanted sales into photo references. All I/O goes through the injected ports. */
export class AuctionIngester {
  constructor(
    private readonly adapter: HouseAdapter,
    private readonly repo: IReferenceRepository,
    private readonly embedder: IImageEmbeddingService,
    private readonly log: (line: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async ingest(options: IngestOptions): Promise<IngestReport> {
    const report: IngestReport = {
      house: this.adapter.house,
      salesKept: [], salesFailed: 0, lotsSeen: 0, lotsCreated: 0, lotsSkippedExisting: 0, lotsSkippedUnsold: 0, lotsFailed: 0, imagesEmbedded: 0, imagesFailed: 0, stoppedByBudget: false,
    }
    const startedAt = this.now()
    const jobs: LotJob[] = []
    // Iterated by hand so the budget is checked before the adapter fetches the next sale's page.
    const sales = this.adapter.listSales(options.year, { saleRef: options.saleRef })[Symbol.asyncIterator]()
    for (;;) {
      if (options.maxRunMs !== undefined && this.now() - startedAt >= options.maxRunMs) {
        report.stoppedByBudget = true
        await sales.return?.()
        return report
      }
      const { value: sale, done } = await sales.next()
      if (done) break
      if (options.saleRef && sale.ref !== options.saleRef) continue
      if (options.closedBetween && !this.isInWindow(sale, options.closedBetween)) continue
      let lotUrls: string[]
      try {
        lotUrls = await this.adapter.listLotUrls(sale)
      } catch (error) {
        report.salesFailed++
        this.log(`sale ${sale.ref} skipped: ${(error as Error).message}`)
        continue
      }
      report.salesKept.push(sale.ref)
      this.log(`kept ${sale.ref} ${sale.name} ${lotUrls.length} lots ${sale.label ?? ''}`)
      const existing = options.dryRun ? new Set<string>() : await this.repo.findExistingLotRefs(this.adapter.house, sale.ref)
      for (const url of lotUrls) {
        if (existing.has(this.adapter.lotRefFromUrl(url))) report.lotsSkippedExisting++
        else jobs.push({ url, sale })
      }
    }
    if (options.dryRun) return report

    const queue = options.limit === undefined ? jobs : jobs.slice(0, options.limit)
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        if (options.maxRunMs !== undefined && this.now() - startedAt >= options.maxRunMs) {
          report.stoppedByBudget = true
          return
        }
        const job = queue[next++]
        report.lotsSeen++
        await this.ingestLot(job, report)
        if (report.lotsSeen % PROGRESS_EVERY === 0) this.log(`progress ${report.lotsSeen}/${queue.length} lots`)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker))
    return report
  }

  private isInWindow(sale: HouseSale, { minAgeDays, maxAgeDays }: { minAgeDays: number; maxAgeDays: number }): boolean {
    // An online sale runs for one to two weeks: until it is finished its lots are not sold yet.
    if (!sale.finished) return false
    if (!sale.closedAt) return false
    const time = Date.parse(sale.closedAt)
    if (Number.isNaN(time)) return false
    const now = this.now()
    return time >= now - maxAgeDays * DAY_MS && time <= now - minAgeDays * DAY_MS
  }

  private async ingestLot({ url, sale }: LotJob, report: IngestReport): Promise<void> {
    try {
      const input = await this.adapter.fetchLot(url, sale)
      if (!input) {
        report.lotsSkippedUnsold++
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
