import { describe, it, expect, vi } from 'vitest'
import { RunReferenceMatchUseCase, type ReferenceMatchConfig } from './RunReferenceMatchUseCase'
import type { ListingToCheck, PendingAlert, ReferenceCandidate } from '@/domain/repositories/IReferenceRepository'

const listing = (id: string, priceCents = 12000, embedded = false): ListingToCheck => ({
  id, title: `title ${id}`, priceCents,
  images: [{ id: `${id}-img`, url: `https://img/${id}.jpg`, hasEmbedding: embedded }],
})
const candidate = (referenceId: string, overrides: Partial<ReferenceCandidate> = {}): ReferenceCandidate => ({
  referenceId, name: `ref ${referenceId}`, note: null, maxPriceCents: null, similarity: 0.8,
  imageUrls: [`https://ref/${referenceId}.jpg`], ...overrides,
})
const alert = (matchId: string): PendingAlert => ({
  matchId, referenceName: 'Desserte Jansen', referenceImageUrl: 'https://ref/a.jpg', listingId: 'l1',
  listingTitle: 'Table roulante', listingUrl: 'https://lbc/l1', priceCents: 12000, city: 'Lyon',
  listingImageUrl: 'https://img/l1.jpg', reason: 'same frame',
})

function setup(opts: {
  active?: boolean
  listings?: ListingToCheck[]
  candidates?: Record<string, ReferenceCandidate[]>
  verdict?: (referenceId: string) => { same: boolean; reason: string | null }
  pending?: PendingAlert[]
  missingRefImages?: Array<{ id: string; url: string }>
  toBackfill?: string[]
  config?: Partial<ReferenceMatchConfig>
  now?: () => number
} = {}) {
  const recorded: any[] = []
  const repo = {
    hasActiveReferences: vi.fn(async () => opts.active ?? true),
    findReferenceImagesMissingEmbedding: vi.fn(async () => opts.missingRefImages ?? []),
    setReferenceImageEmbedding: vi.fn(async () => {}),
    findListingsToCheck: vi.fn(async () => opts.listings ?? []),
    setListingImageEmbedding: vi.fn(async () => {}),
    findCandidates: vi.fn(async (listingId: string, ..._rest: any[]) => opts.candidates?.[listingId] ?? []),
    findRecentListingsCloseTo: vi.fn(async (..._args: any[]): Promise<any[]> => []),
    findReferencesToBackfill: vi.fn(async () => opts.toBackfill ?? []),
    markBackfilled: vi.fn(async () => {}),
    recordMatch: vi.fn(async (m: any) => { recorded.push(m) }),
    markListingChecked: vi.fn(async () => {}),
    findPendingAlerts: vi.fn(async () => opts.pending ?? []),
    markNotified: vi.fn(async () => {}),
  }
  const embedder = { embedImage: vi.fn(async () => [0.1, 0.2]) }
  const verifier = { verify: vi.fn(async (input: any) => (opts.verdict ?? (() => ({ same: true, reason: 'same' })))(input.referenceName.replace('ref ', ''))) }
  const mailer = { send: vi.fn(async (_data: any) => {}) }
  const useCase = new RunReferenceMatchUseCase(repo as any, embedder, verifier, mailer, {
    minSimilarity: 0.75, maxListingsPerRun: 60, backfillDays: 7, emailTo: ['her@example.com'], emailFrom: 'bot@example.com',
    maxRunMs: 120_000, maxVerificationsPerRun: 20, maxCandidatesPerListing: 3, maxBackfillPerReference: 15,
    ...opts.config,
  }, opts.now)
  return { repo, embedder, verifier, mailer, useCase, recorded }
}

describe('RunReferenceMatchUseCase', () => {
  it('does nothing when no reference is active', async () => {
    const { repo, useCase } = setup({ active: false, listings: [listing('l1')] })
    const res = await useCase.execute()
    expect(repo.findListingsToCheck).not.toHaveBeenCalled()
    expect(res).toEqual({ checked: 0, failed: 0, judged: 0, confirmed: 0, alerted: 0 })
  })

  it('embeds reference images that failed at upload before matching', async () => {
    const { repo, embedder, useCase } = setup({ missingRefImages: [{ id: 'ri1', url: 'https://ref/1.jpg' }] })
    await useCase.execute()
    expect(embedder.embedImage).toHaveBeenCalledWith('https://ref/1.jpg')
    expect(repo.setReferenceImageEmbedding).toHaveBeenCalledWith('ri1', [0.1, 0.2])
    expect(repo.setReferenceImageEmbedding.mock.invocationCallOrder[0])
      .toBeLessThan(repo.findListingsToCheck.mock.invocationCallOrder[0])
  })

  it('embeds only listing photos without an embedding', async () => {
    const l = listing('l1')
    l.images.push({ id: 'l1-img2', url: 'https://img/l1b.jpg', hasEmbedding: true })
    const { repo, embedder, useCase } = setup({ listings: [l] })
    await useCase.execute()
    expect(embedder.embedImage).toHaveBeenCalledTimes(1)
    expect(repo.setListingImageEmbedding).toHaveBeenCalledWith('l1-img', [0.1, 0.2])
    expect(repo.markListingChecked).toHaveBeenCalledWith('l1')
  })

  it('records a confirmed match and checks the listing', async () => {
    const { verifier, recorded, useCase } = setup({ listings: [listing('l1')], candidates: { l1: [candidate('a')] } })
    const res = await useCase.execute()
    expect(verifier.verify).toHaveBeenCalledWith({
      listingImageUrls: ['https://img/l1.jpg'], listingTitle: 'title l1',
      referenceImageUrls: ['https://ref/a.jpg'], referenceName: 'ref a', referenceNote: null,
    })
    expect(recorded).toEqual([{ referenceId: 'a', listingId: 'l1', similarity: 0.8, confirmed: true, reason: 'same' }])
    expect(res.confirmed).toBe(1)
  })

  it('records a rejected verdict so the pair is never asked again', async () => {
    const { recorded, useCase } = setup({
      listings: [listing('l1')], candidates: { l1: [candidate('a')] },
      verdict: () => ({ same: false, reason: 'different legs' }),
    })
    const res = await useCase.execute()
    expect(recorded[0]).toMatchObject({ confirmed: false, reason: 'different legs' })
    expect(res.confirmed).toBe(0)
  })

  it('skips a reference whose max price is below the asking price without asking Gemini', async () => {
    const { verifier, recorded, useCase } = setup({
      listings: [listing('l1', 30000)], candidates: { l1: [candidate('a', { maxPriceCents: 15000 })] },
    })
    await useCase.execute()
    expect(verifier.verify).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  it('records one pair per reference when a listing matches two references', async () => {
    const { recorded, useCase } = setup({ listings: [listing('l1')], candidates: { l1: [candidate('a'), candidate('b')] } })
    await useCase.execute()
    expect(recorded.map((m) => m.referenceId)).toEqual(['a', 'b'])
  })

  it('keeps going when one listing fails, and leaves the failed one unchecked', async () => {
    const { repo, embedder, useCase } = setup({ listings: [listing('bad'), listing('good')] })
    embedder.embedImage.mockImplementationOnce(async () => { throw new Error('gemini down') })
    const res = await useCase.execute()
    expect(repo.markListingChecked).toHaveBeenCalledTimes(1)
    expect(repo.markListingChecked).toHaveBeenCalledWith('good')
    expect(res).toMatchObject({ checked: 1, failed: 1 })
  })

  it('emails each pending alert once and marks it notified', async () => {
    const { mailer, repo, useCase } = setup({ pending: [alert('m1'), alert('m2')] })
    const res = await useCase.execute()
    expect(mailer.send).toHaveBeenCalledTimes(2)
    expect(mailer.send.mock.calls[0][0]).toMatchObject({ to: ['her@example.com'], from: 'bot@example.com', subject: '🎯 Ressemble à ta référence : Desserte Jansen' })
    expect(repo.markNotified).toHaveBeenCalledWith('m1')
    expect(repo.markNotified).toHaveBeenCalledWith('m2')
    expect(res.alerted).toBe(2)
  })

  it('leaves an alert pending when the send fails', async () => {
    const { mailer, repo, useCase } = setup({ pending: [alert('m1')] })
    mailer.send.mockRejectedValueOnce(new Error('resend down'))
    const res = await useCase.execute()
    expect(repo.markNotified).not.toHaveBeenCalled()
    expect(res.alerted).toBe(0)
  })

  it('only looks at recent listings and caps candidates per listing', async () => {
    const { repo, useCase } = setup({ listings: [listing('l1')] })
    await useCase.execute()
    expect(repo.findListingsToCheck).toHaveBeenCalledWith(60, 7)
    expect(repo.findCandidates).toHaveBeenCalledWith('l1', 0.75, 3)
  })

  it('stops taking listings once the run deadline has passed, leaving them unchecked', async () => {
    let clock = 0
    const { repo, embedder, useCase } = setup({ listings: [listing('l1'), listing('l2')], now: () => clock })
    embedder.embedImage.mockImplementation(async () => { clock += 200_000; return [0.1] })
    const res = await useCase.execute()
    expect(repo.markListingChecked).toHaveBeenCalledTimes(1)
    expect(repo.markListingChecked).toHaveBeenCalledWith('l1')
    expect(res.checked).toBe(1)
  })

  it('stops before a listing whose candidates exceed the verification budget, keeping it for next run', async () => {
    const { repo, verifier, useCase } = setup({
      listings: [listing('l1'), listing('l2')],
      candidates: { l1: [candidate('a')], l2: [candidate('a'), candidate('b')] },
      config: { maxVerificationsPerRun: 2 },
    })
    await useCase.execute()
    expect(verifier.verify).toHaveBeenCalledTimes(1)
    expect(repo.markListingChecked).toHaveBeenCalledWith('l1')
    expect(repo.markListingChecked).not.toHaveBeenCalledWith('l2')
  })

  it('marks a listing checked when its photos are gone (4xx), without failing the run', async () => {
    const { repo, embedder, useCase } = setup({ listings: [listing('gone')] })
    embedder.embedImage.mockRejectedValueOnce(new Error('Image download failed (404) for https://img/gone.jpg'))
    const res = await useCase.execute()
    expect(repo.markListingChecked).toHaveBeenCalledWith('gone')
    expect(res.failed).toBe(0)
  })

  it('matches on the photos that remain when one of them is gone', async () => {
    const l = listing('l1')
    l.images.push({ id: 'l1-img2', url: 'https://img/l1b.jpg', hasEmbedding: false })
    const { repo, embedder, useCase } = setup({ listings: [l], candidates: { l1: [candidate('a')] } })
    embedder.embedImage.mockRejectedValueOnce(new Error('Image download failed (404) for https://img/l1.jpg'))
    const res = await useCase.execute()
    expect(repo.setListingImageEmbedding).toHaveBeenCalledWith('l1-img2', [0.1, 0.2])
    expect(res).toMatchObject({ checked: 1, confirmed: 1 })
  })

  it('backfills a new reference from the cron, capped, then marks it done and alerts', async () => {
    const { repo, verifier, mailer, useCase, recorded } = setup({ toBackfill: ['new'], pending: [alert('m1')] })
    repo.findRecentListingsCloseTo.mockResolvedValueOnce([{ listing: listing('old', 12000, true), candidate: candidate('new') }])
    const res = await useCase.execute()
    expect(repo.findRecentListingsCloseTo).toHaveBeenCalledWith('new', 0.75, 7, 15)
    expect(verifier.verify).toHaveBeenCalledOnce()
    expect(recorded[0]).toMatchObject({ referenceId: 'new', listingId: 'old', confirmed: true })
    expect(repo.markBackfilled).toHaveBeenCalledWith('new')
    expect(mailer.send).toHaveBeenCalledOnce()
    expect(res).toMatchObject({ judged: 1, confirmed: 1, alerted: 1 })
  })

  it('leaves a backfill pending when the verification budget runs out mid-way', async () => {
    const { repo, verifier, useCase } = setup({ toBackfill: ['new'], config: { maxVerificationsPerRun: 1 } })
    repo.findRecentListingsCloseTo.mockResolvedValueOnce([
      { listing: listing('a1', 12000, true), candidate: candidate('new') },
      { listing: listing('a2', 12000, true), candidate: candidate('new') },
    ])
    await useCase.execute()
    expect(verifier.verify).toHaveBeenCalledTimes(1)
    expect(repo.markBackfilled).not.toHaveBeenCalled()
  })
})
