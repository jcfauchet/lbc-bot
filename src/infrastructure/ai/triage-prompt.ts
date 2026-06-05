import type { TriageResult } from '@/domain/services/ITriageService'

export const TRIAGE_PROMPT = [
  'You are triaging a second-hand listing photo for a vintage furniture & decor reseller.',
  'Rate from 0 to 10 how worth-investigating this piece is: does it LOOK like a vintage,',
  'designer, brass/bronze, lacquer, mid-century or Hollywood-Regency decorative piece that',
  'could have hidden resale value? High score = visually special/old/crafted. Low score =',
  'generic, modern, flat-pack, damaged-beyond-value.',
  'Do NOT try to name a designer or maker. Judge only the visual "worth a closer look" signal.',
  'Reply with strict JSON: {"score": <0-10 integer>, "rationale": "<short>"}',
].join(' ')

export function parseTriageScore(raw: string): TriageResult {
  const rationale = raw.match(/"rationale"\s*:\s*"([^"]*)"/)?.[1]
  const keyed = raw.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/i) ?? raw.match(/score\D{0,12}(-?\d+(?:\.\d+)?)/i)
  const num = keyed?.[1] ?? raw.match(/-?\d+(?:\.\d+)?/)?.[0]
  if (num === undefined) return { score: 0, rationale }
  const score = Math.max(0, Math.min(10, Math.round(Number(num))))
  return { score, rationale }
}
