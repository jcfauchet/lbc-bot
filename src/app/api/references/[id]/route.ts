import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { isReferencesKeyValid } from '../auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 401 })
  }
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { isActive?: unknown } | null
  if (typeof body?.isActive !== 'boolean') return NextResponse.json({ error: 'isActive manquant' }, { status: 400 })
  await container.referenceRepository.setActive(id, body.isActive)
  return NextResponse.json({ ok: true })
}
