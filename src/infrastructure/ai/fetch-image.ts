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
 * Longest edge a model accepts here: Claude rejects the whole request when one
 * image passes 3000 px in a many-image call, which dealer photos (often
 * 3000-4000 px) did. Such a photo is refused, so callers drop it like a failed
 * download. Resizing needs a native image library, which pushed the Vercel
 * function past its 250 MB limit.
 */
export const MAX_IMAGE_EDGE_PX = 3000

/** Width and height read from the file header, or null when the header is not recognised. */
export function imageDimensions(bytes: Buffer): { width: number; height: number } | null {
  const type = sniffImageType(bytes)
  if (type === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (type === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = bytes.subarray(12, 16).toString('ascii')
    if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
    return null
  }
  if (type === 'image/jpeg') {
    // Walk the segments to the first start-of-frame marker, which holds the size.
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
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
  const size = imageDimensions(bytes)
  if (size && Math.max(size.width, size.height) > MAX_IMAGE_EDGE_PX) {
    throw new Error(`Image too large (${size.width}x${size.height}) for ${url}`)
  }
  return { mimeType, data: bytes.toString('base64') }
}
