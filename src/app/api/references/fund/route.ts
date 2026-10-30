import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { isReferencesKeyValid } from '../auth'

export async function GET(req: NextRequest) {
  if (!isReferencesKeyValid(req.nextUrl.searchParams.get('k'), env.REFERENCES_KEY)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 401 })
  }
  const stats = await container.referenceRepository.auctionFundStats()
  return NextResponse.json({ ...stats, enabled: env.AUCTION_REFERENCES_ENABLED })
}
