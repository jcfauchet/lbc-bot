import type { RankingCandidate, RankedPick } from '@/domain/services/ISelectionRanker'

export const RANKING_PROMPT = [
  'You are helping a vintage furniture & decor reseller spend a very scarce research',
  'budget: only a couple of the listings below can be investigated further today.',
  'They have all already passed a first triage, so they all look plausible — your job',
  'is to RANK them against each other and keep only the safest bets.',
  'Prefer the piece you are most confident is genuinely vintage, designer or finely',
  'crafted — distinctive form, materials, construction, patina — over the piece with',
  'the most spectacular apparent bargain. An implausibly large gap between the asking',
  'price and the apparent value usually means the piece is not what it looks like.',
  'Reject outright anything mass-market, modern, reproduction, or damaged beyond',
  'value, however cheap it is.',
  'Set worthCredit to false for any candidate you would not spend the budget on, and',
  'do not pad the list: returning fewer picks is better than returning a weak one.',
  'Reply with strict JSON, best candidate first:',
  '{"picks":[{"candidate":<number>,"worthCredit":<true|false>,"reason":"<short>"}]}',
].join(' ')

/**
 * Hard cap on each injected description. Tighter than triage's 600 because a
 * ranking call carries up to 20 candidates at once.
 */
const MAX_DESCRIPTION_CHARS = 300

/** Hard cap on injected guidance length, matching the triage prompt. */
const MAX_GUIDANCE_CHARS = 2000

/**
 * Renders the candidates as a numbered list. The model answers with these numbers
 * rather than database ids: cuids invite transcription errors, and a mangled id
 * cannot be told apart from a hallucinated one, whereas an out-of-range number can.
 */
export function renderCandidateList(candidates: RankingCandidate[]): string {
  return candidates
    .map((candidate, index) => {
      const lines = [
        `Candidate ${index + 1}: ${candidate.title}`,
        `Asking price: ${candidate.priceEur}€`,
      ]
      const description = candidate.description?.trim()
      if (description) {
        lines.push(`Seller description: ${description.slice(0, MAX_DESCRIPTION_CHARS)}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * Builds the ranking prompt, optionally appending the guidance distilled from past
 * feedback. The lessons that nuance triage scoring apply just as well to breaking
 * ties between qualified candidates.
 */
export function buildRankingPrompt(guidance?: string | null): string {
  const trimmed = guidance?.trim()
  if (!trimmed) return RANKING_PROMPT
  return [
    RANKING_PROMPT,
    '',
    'Lessons learned from past feedback (listings the user later judged worth it or not). Apply them when ranking:',
    trimmed.slice(0, MAX_GUIDANCE_CHARS),
  ].join('\n')
}

/**
 * Parses a ranking reply into picks ordered best-first.
 *
 * Returns `null` when the reply cannot be parsed at all, and `[]` when the model
 * validly returned no pick. The caller must keep these apart: a parse failure has
 * to fall back to deterministic spending, whereas an empty list is a deliberate
 * abstention that spends nothing.
 */
export function parseRanking(raw: string, candidates: RankingCandidate[]): RankedPick[] | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }

  const picks = (parsed as { picks?: unknown })?.picks
  if (!Array.isArray(picks)) return null

  const seen = new Set<string>()
  const ranked: RankedPick[] = []
  for (const entry of picks) {
    if (typeof entry !== 'object' || entry === null) continue
    const { candidate, worthCredit, reason } = entry as Record<string, unknown>
    if (!Number.isInteger(candidate)) continue
    const match = candidates[(candidate as number) - 1]
    if (!match || seen.has(match.listingId)) continue
    seen.add(match.listingId)
    ranked.push({
      listingId: match.listingId,
      rank: ranked.length + 1,
      // Absent flag means the model listed it without reservation.
      worthCredit: worthCredit !== false,
      reason: typeof reason === 'string' ? reason : undefined,
    })
  }
  return ranked
}
