import type { TriageResult } from '@/domain/services/ITriageService'

export const TRIAGE_PROMPT = [
  'You are triaging a second-hand listing photo for a vintage furniture & decor reseller.',
  'Rate from 0 to 10 how worth-investigating this piece is: does it LOOK like a genuinely',
  'vintage, designer, brass/bronze, mid-century or Hollywood-Regency decorative piece that',
  'could have hidden resale value? High score = visually special/old/crafted with distinctive',
  'form, materials or detailing. Low score = generic, modern, flat-pack, damaged-beyond-value.',
  'A glossy lacquered finish is NOT by itself a signal: plenty of cheap modern pieces are',
  'lacquered. Judge the age, materials and construction, not the finish alone.',
  'Do NOT try to name a designer or maker. Judge only the visual "worth a closer look" signal.',
  'Reply with strict JSON: {"score": <0-10 integer>, "rationale": "<short>"}',
].join(' ')

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
