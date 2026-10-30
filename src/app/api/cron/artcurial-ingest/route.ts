import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import type { IngestReport } from '@/infrastructure/artcurial/ArtcurialIngester'
import { logError, logInfo } from '@/infrastructure/logger/logger'

// Same ceiling as the sibling crons; the ingester stops starting lots after MAX_RUN_MS.
export const maxDuration = 800

const MAX_RUN_MS = 600_000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date()
  const currentYear = today.getUTCFullYear()
  // Sales closed in late December are listed in the previous year's sitemap.
  const years = today.getUTCMonth() === 0 ? [currentYear - 1, currentYear] : [currentYear]

  // A year that throws is logged and reported, and does not stop the next one.
  const reports: Array<IngestReport | { year: number; error: string }> = []
  for (const year of years) {
    try {
      const report = await container.artcurialIngester.ingest({
        year,
        closedBetween: { minAgeDays: 2, maxAgeDays: 45 },
        maxRunMs: MAX_RUN_MS,
        dryRun: false,
        concurrency: 3,
      })
      logInfo('CRON:artcurial-ingest', `Year ${year} done`, report)
      reports.push(report)
    } catch (err) {
      logError('CRON:artcurial-ingest', err)
      reports.push({ year, error: String(err) })
    }
  }

  return NextResponse.json({ reports })
}
