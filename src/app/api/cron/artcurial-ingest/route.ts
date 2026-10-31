import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import type { IngestReport } from '@/infrastructure/auction/AuctionIngester'
import type { AuctionHouse } from '@/domain/auction-houses'
import { logError, logInfo } from '@/infrastructure/logger/logger'

export const maxDuration = 800

/** Time budget of one year, shared by the houses. */
const MAX_RUN_MS = 600_000

const HOUSES: AuctionHouse[] = ['ARTCURIAL', 'ROSSINI']

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const currentYear = today.getUTCFullYear()
  const years = today.getUTCMonth() === 0 ? [currentYear - 1, currentYear] : [currentYear]

  const reports: Array<IngestReport | { year: number; house: AuctionHouse; error: string }> = []
  for (const year of years) {
    const startedAt = Date.now()
    for (const [index, house] of HOUSES.entries()) {
      // Even split of what is left, so a house finishing early hands its unused time to the next.
      const remaining = Math.max(0, MAX_RUN_MS - (Date.now() - startedAt))
      const maxRunMs = Math.floor(remaining / (HOUSES.length - index))
      try {
        const report = await container.auctionIngesters[house].ingest({
          year,
          closedBetween: { minAgeDays: 2, maxAgeDays: 45 },
          maxRunMs,
          dryRun: false,
          concurrency: 3,
        })
        logInfo('CRON:artcurial-ingest', `${house} ${year} done`, report)
        reports.push(report)
      } catch (err) {
        logError('CRON:artcurial-ingest', err)
        reports.push({ year, house, error: String(err) })
      }
    }
  }

  return NextResponse.json({ reports })
}
