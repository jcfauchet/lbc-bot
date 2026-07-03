import type { TriageInput, TriageResult } from '@/domain/services/ITriageService'

export const TRIAGE_PROMPT = [
  'You are triaging a second-hand listing for a vintage furniture & decor reseller who',
  'flips undervalued pieces. You get one photo, the listing title and the asking price.',
  'Rate from 0 to 10 the HIDDEN-MARGIN potential: how likely is this piece worth',
  'substantially MORE than its asking price? Score high only when BOTH hold:',
  '(a) it looks genuinely vintage, designer or finely crafted — brass/bronze, mid-century,',
  'Hollywood-Regency, brutalist — with distinctive form, materials or detailing, AND',
  '(b) the asking price looks LOW for what the piece appears to be.',
  'A beautiful piece at a fair or high price has NO hidden margin: score it low.',
  'A generic, modern, flat-pack or damaged-beyond-value piece scores low at any price.',
  'A glossy lacquered finish is NOT by itself a signal: plenty of cheap modern pieces are',
  'lacquered. Judge the age, materials and construction, not the finish alone.',
  'Do NOT try to name a designer or maker.',
  'Reply with strict JSON: {"score": <0-10 integer>, "rationale": "<short>"}',
].join(' ')

/**
 * Renders the per-listing context appended after the prompt. Shared by every
 * triage adapter so the price signal cannot silently drop out of one provider.
 */
export function renderListingContext(input: Pick<TriageInput, 'title' | 'priceEur'>): string {
  return `Listing title: ${input.title}\nAsking price: ${input.priceEur}€`
}

/** Hard cap on injected guidance length to keep prompt token cost bounded. */
const MAX_GUIDANCE_CHARS = 2000

/**
 * Builds the triage prompt, optionally appending learned guidance distilled from
 * past feedback. The guidance carries its own LOWER/RAISE sections. It is advisory:
 * the model still scores 0-10 and the score threshold is unchanged, so guidance can
 * nuance but never hard-filter.
 */
export function buildTriagePrompt(guidance?: string | null): string {
  const trimmed = guidance?.trim()
  if (!trimmed) return TRIAGE_PROMPT
  return [
    TRIAGE_PROMPT,
    '',
    'Lessons learned from past feedback (listings the user later judged worth it or not). Apply them when scoring:',
    trimmed.slice(0, MAX_GUIDANCE_CHARS),
  ].join('\n')
}

export function parseTriageScore(raw: string): TriageResult {
  const rationale = raw.match(/"rationale"\s*:\s*"([^"]*)"/)?.[1]
  const keyed = raw.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/i) ?? raw.match(/score\D{0,12}(-?\d+(?:\.\d+)?)/i)
  const num = keyed?.[1] ?? raw.match(/-?\d+(?:\.\d+)?/)?.[0]
  if (num === undefined) return { score: 0, rationale }
  const score = Math.max(0, Math.min(10, Math.round(Number(num))))
  return { score, rationale }
}
