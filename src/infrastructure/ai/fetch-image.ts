import sharp from 'sharp'

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

/**
 * Longest edge sent to a model. Claude downsizes anything larger itself, but
 * rejects the whole request when an image passes 3000 px in a many-image call,
 * which dealer photos (often 3000-4000 px) did.
 */
export const MAX_IMAGE_EDGE_PX = 1568

/**
 * The image, shrunk to fit MAX_IMAGE_EDGE_PX when it is larger; a GIF comes back
 * as PNG. Bytes sharp cannot decode pass through untouched: the model is the
 * judge of what it accepts, as before resizing existed.
 */
export async function fitImage(bytes: Buffer, mimeType: string): Promise<{ mimeType: string; bytes: Buffer }> {
  const image = sharp(bytes, { animated: false })
  let width = 0
  let height = 0
  try {
    ({ width = 0, height = 0 } = await image.metadata())
  } catch {
    return { mimeType, bytes }
  }
  if (Math.max(width, height) <= MAX_IMAGE_EDGE_PX) return { mimeType, bytes }
  const resized = image.resize({ width: MAX_IMAGE_EDGE_PX, height: MAX_IMAGE_EDGE_PX, fit: 'inside' })
  if (mimeType === 'image/jpeg') return { mimeType, bytes: await resized.jpeg({ quality: 85 }).toBuffer() }
  if (mimeType === 'image/webp') return { mimeType, bytes: await resized.webp({ quality: 85 }).toBuffer() }
  return { mimeType: 'image/png', bytes: await resized.png().toBuffer() }
}

export async function fetchImage(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const declared = response.headers.get('content-type')?.split(';')[0].trim()
  const mimeType = sniffImageType(bytes)
    ?? (SUPPORTED_IMAGE_TYPES.find((t) => t === declared) ?? (declared ? null : 'image/jpeg'))
  if (!mimeType) throw new Error(`Unsupported image format (${declared}) for ${url}`)
  const fitted = await fitImage(bytes, mimeType)
  return { mimeType: fitted.mimeType, data: fitted.bytes.toString('base64') }
}
