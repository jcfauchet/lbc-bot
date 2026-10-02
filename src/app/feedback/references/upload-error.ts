import { MAX_TOTAL_UPLOAD_BYTES, TOO_HEAVY_MESSAGE } from '@/app/api/references/form'

export { TOO_HEAVY_MESSAGE }

/**
 * Above 4.5 MB Vercel rejects the request before the route runs, with a 413
 * and no JSON body, so the status alone has to carry the explanation.
 */
export function uploadErrorMessage(status: number, body: { error?: string }): string {
  if (body.error) return body.error
  if (status === 413) return TOO_HEAVY_MESSAGE
  return 'Erreur, réessaie.'
}

/** Photos the browser could not shrink (e.g. HEIC) can still be too heavy. */
export function isUploadTooHeavy(blobs: Array<{ size: number }>): boolean {
  return blobs.reduce((sum, b) => sum + b.size, 0) > MAX_TOTAL_UPLOAD_BYTES
}
