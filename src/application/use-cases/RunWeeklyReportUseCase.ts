import type { PrismaClient } from '@prisma/client'
import type { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'

export interface ReportedMail {
  listingId: string
  title: string
  url: string
  priceCents: number
  /** Hours from the ad's publication to the email; null when the ad has no publication date. */
  delayHours: number | null
  /** Latest vote, null when nobody voted. */
  isGood: boolean | null
}

export interface ScrapeAttemptRow {
  /** Hour of the attempt, Paris time (0-23). */
  hour: number
  blocked: boolean
}

export interface AppraisalRunRow {
  compCount: number
  costUsd: number
}

export interface WeeklyReport {
  mails: number
  voted: number
  good: number
  /** good / voted, null without votes. */
  precision: number | null
  medianDelayHours: number | null
  appraisals: number
  zeroCompAppraisals: number
  appraisalCostUsd: number
  /** Agent spend divided by emails sent, null without emails. */
  costPerMailUsd: number | null
  scrapeAttempts: number
  scrapeBlocked: number
  /** The hours (Paris time) with the highest block rate, worst first, with at least one block. */
  worstScrapeHours: Array<{ hour: number; attempts: number; blocked: number }>
  unvoted: ReportedMail[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildWeeklyReport(mails: ReportedMail[], appraisals: AppraisalRunRow[], scrapes: ScrapeAttemptRow[]): WeeklyReport {
  const voted = mails.filter((m) => m.isGood !== null)
  const good = voted.filter((m) => m.isGood).length
  const appraisalCostUsd = appraisals.reduce((sum, a) => sum + a.costUsd, 0)

  const byHour = new Map<number, { hour: number; attempts: number; blocked: number }>()
  for (const s of scrapes) {
    const row = byHour.get(s.hour) ?? { hour: s.hour, attempts: 0, blocked: 0 }
    row.attempts++
    if (s.blocked) row.blocked++
    byHour.set(s.hour, row)
  }

  return {
    mails: mails.length,
    voted: voted.length,
    good,
    precision: voted.length ? good / voted.length : null,
    medianDelayHours: median(mails.map((m) => m.delayHours).filter((h): h is number => h !== null)),
    appraisals: appraisals.length,
    zeroCompAppraisals: appraisals.filter((a) => a.compCount === 0).length,
    appraisalCostUsd,
    costPerMailUsd: mails.length ? appraisalCostUsd / mails.length : null,
    scrapeAttempts: scrapes.length,
    scrapeBlocked: scrapes.filter((s) => s.blocked).length,
    worstScrapeHours: [...byHour.values()]
      .filter((h) => h.blocked > 0)
      .sort((a, b) => b.blocked / b.attempts - a.blocked / a.attempts || b.blocked - a.blocked)
      .slice(0, 3),
    unvoted: mails.filter((m) => m.isGood === null),
  }
}

/**
 * Sunday email to the voters: last week's emails still waiting for a vote, and
 * the numbers that say whether the funnel works (precision, delay, cost, blocks).
 * Votes are the only training signal, and they came in three bursts in June.
 */
export class RunWeeklyReportUseCase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: IMailer,
    private readonly to: string[],
    private readonly from: string,
  ) {}

  async execute(now: Date = new Date()): Promise<WeeklyReport> {
    const since = new Date(now.getTime() - 7 * 24 * 3600_000)

    // publishedAt is stored as Paris wall-clock time, sentAt as UTC.
    const mails = await this.prisma.$queryRaw<Array<{
      listingId: string; title: string; url: string; priceCents: number; delayHours: number | null; isGood: boolean | null
    }>>`
      SELECT DISTINCT ON (l.id)
        l.id AS "listingId", l.title, l.url, l."priceCents",
        EXTRACT(EPOCH FROM n."sentAt" - (l."publishedAt" AT TIME ZONE 'Europe/Paris' AT TIME ZONE 'UTC')) / 3600 AS "delayHours",
        (SELECT f."isGood" FROM listing_feedbacks f WHERE f."listingId" = l.id ORDER BY f."createdAt" DESC LIMIT 1) AS "isGood"
      FROM notifications n
      JOIN lbc_product_listings l ON l.id = n."listingId"
      WHERE n.status = 'sent' AND n."sentAt" >= ${since}
      ORDER BY l.id, n."sentAt"`

    const appraisals = await this.prisma.appraisalRun.findMany({
      where: { createdAt: { gte: since } },
      select: { compCount: true, costUsd: true },
    })

    const scrapes = await this.prisma.$queryRaw<Array<{ hour: number; blocked: boolean }>>`
      SELECT EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::int AS hour,
             outcome = 'blocked' AS blocked
      FROM scrape_attempts WHERE "createdAt" >= ${since}`

    const report = buildWeeklyReport(
      mails.map((m) => ({ ...m, delayHours: m.delayHours === null ? null : Number(m.delayHours) })),
      appraisals,
      scrapes,
    )

    if (this.to.length > 0) {
      await this.mailer.send({
        to: this.to,
        from: this.from,
        subject: report.unvoted.length
          ? `🗳️ ${report.unvoted.length} annonce${report.unvoted.length > 1 ? 's' : ''} à noter · bilan de la semaine`
          : '📊 Bilan de la semaine',
        html: EmailTemplates.weeklyReport(report),
      })
    }
    return report
  }
}
