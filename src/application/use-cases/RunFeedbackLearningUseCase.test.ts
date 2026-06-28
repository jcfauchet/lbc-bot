import { describe, it, expect, vi } from 'vitest'
import { RunFeedbackLearningUseCase } from './RunFeedbackLearningUseCase'

const negative = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    listingTitle: `t${i}`,
    priceCents: 8000,
    comment: 'too common',
  }))

const deps = (over: any = {}) => ({
  feedbackRepository: {
    findRecentNegative: vi.fn(async () => over.feedbacks ?? negative(3)),
    findRecentPositive: vi.fn(async () => over.positive ?? []),
  } as any,
  learningService: {
    distil: vi.fn(async () => over.distilled ?? '- avoid common pieces\n- avoid flat-pack'),
  } as any,
  guidanceRepository: {
    getLatest: vi.fn(async () => over.latest ?? null),
    save: vi.fn(async (content: string, count: number, contentHash: string) => ({ id: 'g1', content, sourceFeedbackCount: count, contentHash, createdAt: new Date('2026-06-07') })),
  } as any,
})

describe('RunFeedbackLearningUseCase', () => {
  it('distils and saves guidance when there is new feedback', async () => {
    const d = deps()
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).toHaveBeenCalledOnce()
    expect(d.guidanceRepository.save).toHaveBeenCalledWith(expect.stringContaining('avoid'), 3, expect.any(String))
    expect(res.skipped).toBe(false)
    expect(res.sourceFeedbackCount).toBe(3)
    expect(res.rulesGenerated).toBe(2)
  })

  it('feeds both negative and positive feedback to the distiller', async () => {
    const d = deps({ feedbacks: negative(2), positive: negative(1) })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).toHaveBeenCalledWith(expect.any(Array), expect.any(Array))
    expect(res.sourceFeedbackCount).toBe(3)
  })

  it('skips when there is no feedback', async () => {
    const d = deps({ feedbacks: [], positive: [] })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).not.toHaveBeenCalled()
    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })

  it('skips when the feedback content hash is unchanged since last guidance', async () => {
    // First run captures the hash the routine computes for this exact feedback.
    const first = deps()
    await new RunFeedbackLearningUseCase(first.feedbackRepository, first.learningService, first.guidanceRepository, 200).execute()
    const savedHash = first.guidanceRepository.save.mock.calls[0][2]

    const d = deps({ latest: { id: 'g0', content: 'x', sourceFeedbackCount: 3, contentHash: savedHash, createdAt: new Date() } })
    const res = await new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200).execute()

    expect(d.learningService.distil).not.toHaveBeenCalled()
    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })

  it('re-learns when a comment changes even though the count is identical', async () => {
    const edited = negative(3).map((f, i) => (i === 0 ? { ...f, comment: 'edited reason' } : f))
    // latest hash is from the original comments, but the feedback now differs.
    const original = deps()
    await new RunFeedbackLearningUseCase(original.feedbackRepository, original.learningService, original.guidanceRepository, 200).execute()
    const originalHash = original.guidanceRepository.save.mock.calls[0][2]

    const d = deps({ feedbacks: edited, latest: { id: 'g0', content: 'x', sourceFeedbackCount: 3, contentHash: originalHash, createdAt: new Date() } })
    const res = await new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200).execute()

    expect(d.learningService.distil).toHaveBeenCalledOnce()
    expect(d.guidanceRepository.save).toHaveBeenCalled()
    expect(res.skipped).toBe(false)
  })

  it('does not overwrite previous guidance when distillation is empty', async () => {
    const d = deps({ distilled: '   ' })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })
})
