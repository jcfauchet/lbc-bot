export const MAX_IMAGES = 5
/** Vercel caps request bodies at 4.5 MB; keep headroom for the multipart envelope. */
export const MAX_TOTAL_UPLOAD_BYTES = 4_000_000

export function parseMaxPriceCents(raw: string): number | null | 'invalid' {
  const compact = raw.replace(/[\s  €]/g, '').replace(',', '.')
  if (compact === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) return 'invalid'
  const cents = Math.round(Number(compact) * 100)
  return cents > 0 ? cents : 'invalid'
}

type FormInput = { name: unknown; maxPrice: unknown; note: unknown; images: Array<{ size: number; type: string }> }
type FormResult =
  | { ok: true; value: { name: string; note: string | null; maxPriceCents: number | null } }
  | { ok: false; status: 400 | 413; error: string }

export function parseReferenceForm(input: FormInput): FormResult {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return { ok: false, status: 400, error: 'Donne un nom à la référence.' }

  if (input.images.length < 1 || input.images.length > MAX_IMAGES) {
    return { ok: false, status: 400, error: `Ajoute entre 1 et ${MAX_IMAGES} photos.` }
  }
  if (input.images.some((i) => !i.type.startsWith('image/'))) {
    return { ok: false, status: 400, error: 'Seules les photos sont acceptées.' }
  }
  if (input.images.reduce((sum, i) => sum + i.size, 0) > MAX_TOTAL_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: 'Photos trop lourdes : envoie-en moins ou des captures plus petites.' }
  }

  const maxPriceCents = parseMaxPriceCents(typeof input.maxPrice === 'string' ? input.maxPrice : '')
  if (maxPriceCents === 'invalid') return { ok: false, status: 400, error: 'Le prix max doit être un nombre, par ex. 150.' }

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null
  return { ok: true, value: { name, note, maxPriceCents } }
}
