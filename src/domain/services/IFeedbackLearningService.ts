import type { NegativeFeedbackItem } from '@/domain/repositories/IFeedbackRepository'

export interface IFeedbackLearningService {
  /**
   * Distils negative feedback into a compact set of "avoid" rules to be injected
   * into the triage prompt. Returns plain bullet lines (may be empty if there is
   * nothing useful to learn).
   */
  distil(feedbacks: NegativeFeedbackItem[]): Promise<string>
}
