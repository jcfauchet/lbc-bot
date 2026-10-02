import type { ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'

export function buildReferenceMatchPrompt(
  input: Pick<ReferenceMatchInput, 'listingTitle' | 'referenceName' | 'referenceNote'> & {
    listingImageCount: number
    referenceImageCount: number
  },
): string {
  return [
    'You help a vintage furniture reseller spot a specific piece she is looking for.',
    `The first ${input.listingImageCount} images are photos from a second-hand listing titled "${input.listingTitle}".`,
    `The next ${input.referenceImageCount} images show her reference piece: "${input.referenceName}".`,
    input.referenceNote ? `Her note about the reference: ${input.referenceNote}` : '',
    'Is the listing the SAME model/design as the reference (same maker or a faithful edition),',
    'judged on form, proportions, materials and construction details? Ignore colour cast,',
    'lighting, background, condition and photo angle. A piece that is merely the same kind of',
    'object or the same style is NOT the same model.',
    'Reply with strict JSON: {"same": true|false, "reason": "<one short sentence>"}',
  ].filter(Boolean).join('\n')
}

/** Anything other than a parseable object with `same: true` counts as no match. */
export function parseReferenceVerdict(raw: string): ReferenceVerdict {
  const object = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return { same: false, reason: null }
  try {
    const parsed = JSON.parse(object) as { same?: unknown; reason?: unknown }
    if (parsed.same !== true && parsed.same !== false) return { same: false, reason: null }
    return { same: parsed.same, reason: typeof parsed.reason === 'string' ? parsed.reason : null }
  } catch {
    return { same: false, reason: null }
  }
}
