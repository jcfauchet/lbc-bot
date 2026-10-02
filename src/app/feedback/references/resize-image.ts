const MAX_SIDE = 1600
const QUALITY = 0.85

/**
 * Phone photos are 3-8 MB; Vercel rejects request bodies above 4.5 MB. Re-encode
 * to a ≤1600px JPEG (~200-400 KB) before upload. Falls back to the original file
 * when the browser cannot decode it.
 */
export async function resizeImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    return blob ?? file
  } catch {
    return file
  }
}
