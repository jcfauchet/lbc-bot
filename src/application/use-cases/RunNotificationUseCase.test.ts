import { describe, it, expect, vi } from 'vitest'
import { RunNotificationUseCase } from './RunNotificationUseCase'
import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

const listing = (id: string) => {
  const l = Listing.create({ lbcId: id, searchId: 's', url: 'u', title: id, price: Money.fromEuros(80), status: ListingStatus.ANALYZED })
  ;(l as any).props = { ...(l as any).props, id }
  return l
}

const analysis = (listingId: string, confidence: number, estMinEuros = 1000) =>
  AiAnalysis.create({
    listingId,
    estimatedMinPrice: Money.fromEuros(estMinEuros),
    estimatedMaxPrice: Money.fromEuros(1500),
    margin: Money.fromEuros(900),
    description: 'd',
    confidence,
    provider: 'serpapi',
  })

const deps = (analyses: AiAnalysis[]) => {
  const listings: Record<string, Listing> = { reliable: listing('reliable'), shaky: listing('shaky') }
  const savedNotifications: any[] = []
  return {
    savedNotifications,
    aiAnalysisRepository: { findByMinMargin: vi.fn(async () => analyses) } as any,
    listingRepository: {
      findById: vi.fn(async (id: string) => listings[id] ?? null),
      update: vi.fn(async (l: Listing) => l),
    } as any,
    notificationRepository: {
      findByListingId: vi.fn(async () => []),
      save: vi.fn(async (n: any) => { savedNotifications.push(n); return n }),
    } as any,
    imageRepository: { findByListingId: vi.fn(async () => [{ urlRemote: 'https://img/x.jpg' }]) } as any,
    mailer: { send: vi.fn(async () => {}) } as any,
  }
}

describe('RunNotificationUseCase', () => {
  it('does not notify analyses whose comps disagree (confidence below threshold)', async () => {
    const d = deps([analysis('reliable', 0.9), analysis('shaky', 0.6)])
    const useCase = new RunNotificationUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.notificationRepository, d.imageRepository,
      d.mailer, ['to@x.fr'], 'from@x.fr', 60,
    )

    const res = await useCase.execute()

    expect(res.sent).toBe(1)
    expect(d.savedNotifications).toHaveLength(1)
    expect(d.savedNotifications[0].listingId).toBe('reliable')
  })

  it('does not notify when the conservative margin (estMin - price) is below the floor', async () => {
    // Median margin (900€) passes the coarse prefilter and confidence is high,
    // but the worst-case resale (estMin 100€ − price 80€ = 20€) leaves no real
    // margin, so the deal must not be emailed.
    const d = deps([analysis('reliable', 0.9, 100)])
    const useCase = new RunNotificationUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.notificationRepository, d.imageRepository,
      d.mailer, ['to@x.fr'], 'from@x.fr', 60, 0.8, 6000,
    )

    const res = await useCase.execute()

    expect(res.sent).toBe(0)
    expect(d.mailer.send).not.toHaveBeenCalled()
  })

  it('sends nothing when every deal is below the confidence threshold', async () => {
    const d = deps([analysis('shaky', 0.6)])
    const useCase = new RunNotificationUseCase(
      d.listingRepository, d.aiAnalysisRepository, d.notificationRepository, d.imageRepository,
      d.mailer, ['to@x.fr'], 'from@x.fr', 60,
    )

    const res = await useCase.execute()

    expect(res.sent).toBe(0)
    expect(d.mailer.send).not.toHaveBeenCalled()
  })
})
