import { describe, it, expect } from 'vitest'
import { buildWeeklyReport, type ReportedMail } from './RunWeeklyReportUseCase'

const mail = (listingId: string, isGood: boolean | null, delayHours: number | null = 2): ReportedMail =>
  ({ listingId, title: listingId, url: 'u', priceCents: 10000, delayHours, isGood })

describe('buildWeeklyReport', () => {
  it('computes precision over voted mails only and lists the unvoted ones', () => {
    const report = buildWeeklyReport([mail('a', true), mail('b', false), mail('c', null)], [], [])

    expect(report).toMatchObject({ mails: 3, voted: 2, good: 1, precision: 0.5 })
    expect(report.unvoted.map((m) => m.listingId)).toEqual(['c'])
  })

  it('takes the median delay, ignoring ads without a publication date', () => {
    const report = buildWeeklyReport([mail('a', null, 1), mail('b', null, 9), mail('c', null, 4), mail('d', null, null)], [], [])

    expect(report.medianDelayHours).toBe(4)
  })

  it('divides the agent spend by the mails sent and counts zero-comp runs', () => {
    const report = buildWeeklyReport(
      [mail('a', null), mail('b', null)],
      [{ compCount: 0, costUsd: 0.1 }, { compCount: 3, costUsd: 0.3 }],
      [],
    )

    expect(report.zeroCompAppraisals).toBe(1)
    expect(report.costPerMailUsd).toBeCloseTo(0.2)
  })

  it('ranks the scrape hours by block rate, leaving out hours never blocked', () => {
    const report = buildWeeklyReport([], [], [
      { hour: 9, blocked: true }, { hour: 9, blocked: false },
      { hour: 21, blocked: true },
      { hour: 3, blocked: false },
    ])

    expect(report).toMatchObject({ scrapeAttempts: 4, scrapeBlocked: 2, precision: null, costPerMailUsd: null })
    expect(report.worstScrapeHours).toEqual([
      { hour: 21, attempts: 1, blocked: 1 },
      { hour: 9, attempts: 2, blocked: 1 },
    ])
  })
})
