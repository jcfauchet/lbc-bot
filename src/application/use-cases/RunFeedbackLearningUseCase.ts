import type { IFeedbackRepository } from '@/domain/repositories/IFeedbackRepository'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { ITriageGuidanceRepository } from '@/domain/repositories/ITriageGuidanceRepository'

export interface FeedbackLearningResult {
  skipped: boolean
  reason?: 'no-feedback' | 'unchanged' | 'empty-distillation'
  rulesGenerated: number
  sourceFeedbackCount: number
}

export class RunFeedbackLearningUseCase {
  constructor(
    private feedbackRepository: IFeedbackRepository,
    private learningService: IFeedbackLearningService,
    private guidanceRepository: ITriageGuidanceRepository,
    private maxFeedbackItems: number,
  ) {}

  async execute(): Promise<FeedbackLearningResult> {
    const feedbacks = await this.feedbackRepository.findRecentNegative(this.maxFeedbackItems)

    if (feedbacks.length === 0) {
      return { skipped: true, reason: 'no-feedback', rulesGenerated: 0, sourceFeedbackCount: 0 }
    }

    // Idempotent: skip the LLM call when nothing new has arrived since last run.
    const latest = await this.guidanceRepository.getLatest()
    if (latest && latest.sourceFeedbackCount === feedbacks.length) {
      return { skipped: true, reason: 'unchanged', rulesGenerated: 0, sourceFeedbackCount: feedbacks.length }
    }

    const content = (await this.learningService.distil(feedbacks)).trim()
    if (!content) {
      // Never overwrite a previously useful guidance with an empty distillation.
      return { skipped: true, reason: 'empty-distillation', rulesGenerated: 0, sourceFeedbackCount: feedbacks.length }
    }

    await this.guidanceRepository.save(content, feedbacks.length)

    const rulesGenerated = content.split('\n').filter((l) => l.trim().startsWith('-')).length
    return { skipped: false, rulesGenerated, sourceFeedbackCount: feedbacks.length }
  }
}
