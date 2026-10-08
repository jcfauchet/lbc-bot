/**
 * Photos kept per ad. The cover feeds triage and comps; the rest only serve
 * reference matching, so six is plenty and bounds the embedding spend.
 */
export const MAX_IMAGES_PER_LISTING = 6

const SMALL_RULE = 'ad-small'

export interface LbcAdImages {
  small_url?: string
  urls?: string[]
}

/** Image id (path without query) so the same photo under two rules is one photo. */
function imageKey(url: string): string {
  return url.split('?')[0]
}

function asSmall(url: string): string {
  const [path, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  params.set('rule', SMALL_RULE)
  return `${path}?${params.toString()}`
}

/**
 * Cover first (as LBC serves it), then the other photos rewritten to the
 * small rendition: enough for an embedding, cheap to fetch.
 */
export function listingImageUrls(images: LbcAdImages | undefined): string[] {
  if (!images?.small_url) return []
  const result = [images.small_url]
  const seen = new Set([imageKey(images.small_url)])
  for (const url of images.urls ?? []) {
    if (result.length >= MAX_IMAGES_PER_LISTING) break
    const key = imageKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(asSmall(url))
  }
  return result
}
