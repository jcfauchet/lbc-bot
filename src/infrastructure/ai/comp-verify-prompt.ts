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
export async function buildCompVerifyRequest(input: { listingTitle: string; listingImageUrls: string[]; candidates: CompMatch[] }): Promise<CompVerifyPart[]> {
  const adPhotos = await loadPhotos(input.listingImageUrls.slice(0, COMP_VERIFY_LISTING_PHOTOS))
  if (adPhotos.length === 0) throw new Error(`No ad photo could be downloaded for "${input.listingTitle}"`)
  const candidateParts = await Promise.all(input.candidates.map(async (c, i): Promise<CompVerifyPart[]> => {
    const photos = await loadPhotos(c.photoUrls?.length ? c.photoUrls : [c.imageUrl!])
    return [{ text: photos.length ? `Candidate ${i + 1}` : `Candidate ${i + 1} (photos unavailable)` }, ...photos]
  }))
  return [
    { text: INSTRUCTIONS },
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
