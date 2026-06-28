import type { FeedbackDigestItem } from '@/domain/repositories/IFeedbackRepository'

export interface IFeedbackLearningService {
  /**
   * Distils past feedback into a compact, two-direction checklist injected into
   * the triage prompt: rules to LOWER the score (from listings judged not worth
   * it) and rules to RAISE it (from listings judged worth it). Returns plain
   * bullet lines (may be empty if there is nothing useful to learn).
   */
  distil(negative: FeedbackDigestItem[], positive: FeedbackDigestItem[]): Promise<string>
}
