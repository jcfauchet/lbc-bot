import { describe, it, expect, vi } from 'vitest'
import { RunReferenceMatchUseCase } from './RunReferenceMatchUseCase'
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
} = {}) {
  const recorded: any[] = []
  const repo = {
    hasActiveReferences: vi.fn(async () => opts.active ?? true),
    findReferenceImagesMissingEmbedding: vi.fn(async () => opts.missingRefImages ?? []),
    setReferenceImageEmbedding: vi.fn(async () => {}),
    findListingsToCheck: vi.fn(async () => opts.listings ?? []),
    setListingImageEmbedding: vi.fn(async () => {}),
    findCandidates: vi.fn(async (listingId: string) => opts.candidates?.[listingId] ?? []),
    findRecentListingsCloseTo: vi.fn(async (..._args: any[]): Promise<any[]> => []),
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
  })
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

  it('backfill judges recent close listings for the new reference and sends alerts', async () => {
    const { repo, verifier, mailer, useCase, recorded } = setup({ pending: [alert('m1')] })
    repo.findRecentListingsCloseTo.mockResolvedValueOnce([{ listing: listing('old', 12000, true), candidate: candidate('new') }])
    const res = await useCase.backfill('new')
    expect(repo.findRecentListingsCloseTo).toHaveBeenCalledWith('new', 0.75, 7)
    expect(verifier.verify).toHaveBeenCalledOnce()
    expect(recorded[0]).toMatchObject({ referenceId: 'new', listingId: 'old', confirmed: true })
    expect(mailer.send).toHaveBeenCalledOnce()
    expect(res).toMatchObject({ judged: 1, confirmed: 1, alerted: 1 })
  })
})
