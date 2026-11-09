import type { CompMatch } from '@/domain/services/ICompService'
import { fetchImage } from './fetch-image'

/** Ad photos shown to the verifier; matches the reference verifier's VERIFIER_LISTING_PHOTOS. */
export const COMP_VERIFY_LISTING_PHOTOS = 4
/** Bounds the vision tokens per call; Lens rarely yields more priced value comps anyway. */
export const MAX_COMP_CANDIDATES = 8

/** The comparables a verifier is shown, in the order their numbers refer to. */
export function compCandidates(comps: CompMatch[]): CompMatch[] {
  return comps.filter((c) => c.photoUrls?.length || c.imageUrl).slice(0, MAX_COMP_CANDIDATES)
}

const INSTRUCTIONS = [
  'You help a vintage furniture reseller price a piece from a second-hand ad.',
  'Below come photos of the ad piece, then candidate comparables found by reverse-image search.',
  'Each candidate starts with a line "Candidate <number>" followed by one or more photos of that one candidate.',
  'Use every photo, detail shots included, on both sides.',
  'A candidate counts only if it shows the SAME model/design as the ad piece (same maker or a faithful edition),',
  'judged on form, proportions, materials and construction details. Ignore colour cast, lighting, background,',
  'condition and photo angle. A piece that is merely the same kind of object, the same style or a look-alike does NOT count.',
  'Reply with strict JSON: {"confirmed": [<numbers of the candidates that are the same model>]}',
  'An empty list is a valid answer.',
].join('\n')

/**
 * Graded variant, for backtesting a looser filter: same model is rare (Oct–Nov 2026,
 * 23 of 99 analyses had two), so "same line" and "resemblance" are asked apart.
 */
export const TIERED_COMP_VERIFY_INSTRUCTIONS = [
  'You help a vintage furniture reseller price a piece from a second-hand ad.',
  'Below come photos of the ad piece, then candidate comparables found by reverse-image search.',
  'Each candidate starts with a line "Candidate <number>" followed by one or more photos of that one candidate.',
  'Use every photo, detail shots included, on both sides. Ignore colour cast, lighting, background, condition and photo angle.',
  'Grade each candidate against the ad piece:',
  '- "same_model": the same model/design (same maker or a faithful edition): form, proportions, materials and construction details match.',
  '- "same_line": not the same model, but the same maker, range or series, or a variant of the model (other size, finish or number of elements), so its price says something about the ad piece.',
  '- "resemblance": the same kind of object in a similar style or period, but nothing ties it to the ad piece\'s maker or series.',
  'A candidate that is none of these (another kind of object, another style) goes in no list.',
  'Reply with strict JSON: {"same_model": [<numbers>], "same_line": [<numbers>], "resemblance": [<numbers>]}',
  'Empty lists are valid answers.',
].join('\n')

export type CompTier = 'same_model' | 'same_line' | 'resemblance' | 'none'

const TIERS_BEST_FIRST: Exclude<CompTier, 'none'>[] = ['same_model', 'same_line', 'resemblance']

/** One tier per candidate, from 1-based indices; a number listed twice keeps its best tier. Unparseable means none. */
export function parseTieredCompVerdicts(raw: string, compCount: number): CompTier[] {
  const tiers = Array.from({ length: compCount }, (): CompTier => 'none')
  const object = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return tiers
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(object) as Record<string, unknown>
  } catch {
    return tiers
  }
  for (const tier of [...TIERS_BEST_FIRST].reverse()) {
    const list = parsed[tier]
    if (!Array.isArray(list)) continue
    for (const n of list) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= compCount) tiers[n - 1] = tier
    }
  }
  return tiers
}

/** The weaker of two graders' tiers: both must agree for a candidate to reach a tier. */
export function weakerTier(a: CompTier, b: CompTier): CompTier {
  const rank = (t: CompTier) => (t === 'none' ? TIERS_BEST_FIRST.length : TIERS_BEST_FIRST.indexOf(t))
  return rank(a) >= rank(b) ? a : b
}

export type CompVerifyPart = { text: string } | { image: { mimeType: string; data: string } }

async function loadPhotos(urls: string[]): Promise<CompVerifyPart[]> {
  const loaded = await Promise.allSettled(urls.map(fetchImage))
  return loaded.flatMap((r) => (r.status === 'fulfilled' ? [{ image: r.value }] : []))
}

/**
 * The whole request, in order: instructions, the ad photos, then each candidate's
 * numbered label and photos (dealer-page photos when fetched, else the Lens
 * thumbnail). A photo that fails to download is left out; a candidate left with
 * none keeps its label, so the numbering still matches, and cannot be confirmed.
 */
export async function buildCompVerifyRequest(
  input: { listingTitle: string; listingImageUrls: string[]; candidates: CompMatch[] },
  instructions = INSTRUCTIONS,
): Promise<CompVerifyPart[]> {
  const adPhotos = await loadPhotos(input.listingImageUrls.slice(0, COMP_VERIFY_LISTING_PHOTOS))
  if (adPhotos.length === 0) throw new Error(`No ad photo could be downloaded for "${input.listingTitle}"`)
  const candidateParts = await Promise.all(input.candidates.map(async (c, i): Promise<CompVerifyPart[]> => {
    const photos = await loadPhotos(c.photoUrls?.length ? c.photoUrls : [c.imageUrl!])
    return [{ text: photos.length ? `Candidate ${i + 1}` : `Candidate ${i + 1} (photos unavailable)` }, ...photos]
  }))
  return [
    { text: instructions },
    { text: `Ad piece, titled "${input.listingTitle}":` },
    ...adPhotos,
    ...candidateParts.flat(),
  ]
}

/** One flag per candidate, from 1-based indices. Anything unparseable confirms nothing. */
export function parseCompVerdicts(raw: string, compCount: number): boolean[] {
  const flags = Array.from({ length: compCount }, () => false)
  const object = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!object) return flags
  try {
    const parsed = JSON.parse(object) as { confirmed?: unknown }
    if (!Array.isArray(parsed.confirmed)) return flags
    for (const n of parsed.confirmed) {
      if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= compCount) flags[n - 1] = true
    }
  } catch {
    return flags
  }
  return flags
}
