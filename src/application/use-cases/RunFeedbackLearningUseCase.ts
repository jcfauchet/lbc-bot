import { createHash } from 'node:crypto'
import type { FeedbackDigestItem, IFeedbackRepository } from '@/domain/repositories/IFeedbackRepository'
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { ITriageGuidanceRepository } from '@/domain/repositories/ITriageGuidanceRepository'

export interface FeedbackLearningResult {
  skipped: boolean
  reason?: 'no-feedback' | 'unchanged' | 'empty-distillation'
  rulesGenerated: number
  sourceFeedbackCount: number
}

/**
 * Hashes the exact feedback set (vote, title, price, comment) so the routine
 * re-learns when content changes — not merely when the item count changes. This
 * catches edited comments and a plateaued count at the cap, both of which the
 * old count-only check silently ignored.
 */
function hashFeedback(negative: FeedbackDigestItem[], positive: FeedbackDigestItem[]): string {
  const fingerprint = (vote: string, items: FeedbackDigestItem[]) =>
    items.map((f) => `${vote}|${f.listingTitle}|${f.priceCents}|${f.comment ?? ''}`).join('\n')
  const payload = `${fingerprint('-', negative)}\n##\n${fingerprint('+', positive)}`
  return createHash('sha256').update(payload).digest('hex')
}

export class RunFeedbackLearningUseCase {
  constructor(
    private feedbackRepository: IFeedbackRepository,
    private learningService: IFeedbackLearningService,
    private guidanceRepository: ITriageGuidanceRepository,
    private maxFeedbackItems: number,
  ) {}

  async execute(): Promise<FeedbackLearningResult> {
    const [negative, positive] = await Promise.all([
      this.feedbackRepository.findRecentNegative(this.maxFeedbackItems),
      this.feedbackRepository.findRecentPositive(this.maxFeedbackItems),
    ])
    const total = negative.length + positive.length

    if (total === 0) {
      return { skipped: true, reason: 'no-feedback', rulesGenerated: 0, sourceFeedbackCount: 0 }
    }

    // Idempotent: skip the LLM call when the exact feedback content is unchanged
    // since the last run (count-only checks miss edited comments / a capped count).
    const hash = hashFeedback(negative, positive)
    const latest = await this.guidanceRepository.getLatest()
    if (latest && latest.contentHash === hash) {
      return { skipped: true, reason: 'unchanged', rulesGenerated: 0, sourceFeedbackCount: total }
    }

    const content = (await this.learningService.distil(negative, positive)).trim()
    if (!content) {
      // Never overwrite a previously useful guidance with an empty distillation.
      return { skipped: true, reason: 'empty-distillation', rulesGenerated: 0, sourceFeedbackCount: total }
    }

    await this.guidanceRepository.save(content, total, hash)

    const rulesGenerated = content.split('\n').filter((l) => l.trim().startsWith('-')).length
    return { skipped: false, rulesGenerated, sourceFeedbackCount: total }
  }
}
