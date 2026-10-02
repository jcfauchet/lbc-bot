/** Long enough for a slow CDN, short enough that one stalled download cannot hold a cron stage. */
export const IMAGE_FETCH_TIMEOUT_MS = 15_000

export async function fetchImage(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`)
  const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  return { mimeType, data: Buffer.from(await response.arrayBuffer()).toString('base64') }
}
