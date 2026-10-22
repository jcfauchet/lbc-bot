/** Long enough for a slow CDN, short enough that one stalled download cannot hold a cron stage. */
export const IMAGE_FETCH_TIMEOUT_MS = 15_000

/** The formats both Claude and Gemini accept. */
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

/**
 * The image format read from the file's first bytes. Dealer CDNs often send a
 * generic or wrong content-type, and Claude rejects the whole request over one
 * mislabelled image. Null for anything else (AVIF, HEIC, an HTML error page).
 */
export function sniffImageType(bytes: Buffer): (typeof SUPPORTED_IMAGE_TYPES)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

export async function fetchImage(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const declared = response.headers.get('content-type')?.split(';')[0].trim()
  const mimeType = sniffImageType(bytes)
    ?? (SUPPORTED_IMAGE_TYPES.find((t) => t === declared) ?? (declared ? null : 'image/jpeg'))
  if (!mimeType) throw new Error(`Unsupported image format (${declared}) for ${url}`)
  return { mimeType, data: bytes.toString('base64') }
}
