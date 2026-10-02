import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { isReferencesKeyValid } from './auth'
import { parseReferenceForm } from './form'

export const maxDuration = 120

const unauthorized = () => NextResponse.json({ error: 'Lien invalide' }, { status: 401 })

export async function GET(req: NextRequest) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) return unauthorized()
  return NextResponse.json(await container.referenceRepository.list())
}

export async function POST(req: NextRequest) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) return unauthorized()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Envoi illisible, réessaie.' }, { status: 400 })
  }
  const files = form.getAll('images').filter((f): f is File => f instanceof File)
  const parsed = parseReferenceForm({
    name: form.get('name'), maxPrice: form.get('maxPrice'), note: form.get('note'),
    images: files.map((f) => ({ size: f.size, type: f.type })),
  })
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  try {
    // Upload first so a Cloudinary failure leaves no half-created reference.
    const uploadKey = randomUUID()
    const imageUrls = await Promise.all(files.map(async (file, index) =>
      container.storageService.saveReferenceImage(Buffer.from(await file.arrayBuffer()), file.type, uploadKey, index)))
    const created = await container.referenceRepository.create(parsed.value, imageUrls)

    // Best-effort: an image left without embedding is retried by the cron stage.
    await Promise.all(created.images.map(async (image) => {
      try {
        await container.referenceRepository.setReferenceImageEmbedding(image.id, await container.imageEmbeddingService.embedImage(image.url))
      } catch (err) {
        console.error(`Reference image embedding failed for ${image.id}:`, err)
      }
    }))

    // The 7-day backfill runs in the next cron pass, not here: it can take
    // minutes, and a timed-out upload invites a retry that duplicates the reference.
    return NextResponse.json({ id: created.id })
  } catch (err) {
    console.error('Reference creation failed:', err)
    return NextResponse.json({ error: "L'enregistrement a échoué, réessaie dans un instant." }, { status: 500 })
  }
}
