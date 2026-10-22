import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'

/**
 * Confirms a comparable only when both verifiers do: a lone "same model" is
 * usually wrong, and two models rarely make the same mistake. Backtested on the
 * user's votes on 22 Oct 2026 (45 comps, sharp dealer photos): Opus and Sonnet
 * together confirmed 2 look-alikes, against 3 for Opus alone and 18 for the
 * thumbnail-only Gemini check it replaces.
 *
 * If either verifier fails the whole check fails, and the analysis is saved
 * unchecked (no badge) rather than vouched for by one model alone.
 */
export class ConsensusCompVerifier implements ICompVerifier {
  constructor(private readonly first: ICompVerifier, private readonly second: ICompVerifier) {}

  async verify(input: CompVerifyInput): Promise<CompMatch[]> {
    const [a, b] = await Promise.all([this.first.verify(input), this.second.verify(input)])
    const confirmedBySecond = new Set(b)
    return a.filter((comp) => confirmedBySecond.has(comp))
  }
}
