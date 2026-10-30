import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import type { IngestReport } from '@/infrastructure/artcurial/ArtcurialIngester'

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

  const reports: IngestReport[] = []
  for (const year of years) {
    const report = await container.artcurialIngester.ingest({
      year,
      closedBetween: { minAgeDays: 2, maxAgeDays: 45 },
      maxRunMs: MAX_RUN_MS,
      dryRun: false,
      concurrency: 3,
    })
    console.log(`CRON:artcurial-ingest ${year}`, JSON.stringify(report))
    reports.push(report)
  }

  return NextResponse.json({ reports })
}
