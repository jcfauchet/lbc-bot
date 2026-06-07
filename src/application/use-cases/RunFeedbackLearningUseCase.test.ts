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
  } as any,
  learningService: {
    distil: vi.fn(async () => over.distilled ?? '- avoid common pieces\n- avoid flat-pack'),
  } as any,
  guidanceRepository: {
    getLatest: vi.fn(async () => over.latest ?? null),
    save: vi.fn(async (content: string, count: number) => ({ id: 'g1', content, sourceFeedbackCount: count, createdAt: new Date('2026-06-07') })),
  } as any,
})

describe('RunFeedbackLearningUseCase', () => {
  it('distils and saves guidance when there is new feedback', async () => {
    const d = deps()
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).toHaveBeenCalledOnce()
    expect(d.guidanceRepository.save).toHaveBeenCalledWith(expect.stringContaining('avoid'), 3)
    expect(res.skipped).toBe(false)
    expect(res.sourceFeedbackCount).toBe(3)
    expect(res.rulesGenerated).toBe(2)
  })

  it('skips when there is no feedback', async () => {
    const d = deps({ feedbacks: [] })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).not.toHaveBeenCalled()
    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })

  it('skips when feedback count is unchanged since last guidance', async () => {
    const d = deps({ feedbacks: negative(3), latest: { id: 'g0', content: 'x', sourceFeedbackCount: 3, createdAt: new Date() } })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.learningService.distil).not.toHaveBeenCalled()
    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })

  it('does not overwrite previous guidance when distillation is empty', async () => {
    const d = deps({ distilled: '   ' })
    const useCase = new RunFeedbackLearningUseCase(d.feedbackRepository, d.learningService, d.guidanceRepository, 200)
    const res = await useCase.execute()

    expect(d.guidanceRepository.save).not.toHaveBeenCalled()
    expect(res.skipped).toBe(true)
  })
})
