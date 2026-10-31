import { NextRequest, NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { env } from '@/infrastructure/config/env'
import { HOUSE_LABELS, type AuctionHouse } from '@/domain/auction-houses'
import { LOT_CATEGORIES, type LotCategory } from '@/domain/lot-category'
import { isReferencesKeyValid } from '../../auth'

const PAGE_SIZE = 48

/** One page of the auction fund, filterable by house, object category and text. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  if (!isReferencesKeyValid(params.get('k'), env.REFERENCES_KEY)) {
    return NextResponse.json({ error: 'Lien invalide' }, { status: 401 })
  }
  const houseParam = params.get('house')
  const house = houseParam && Object.hasOwn(HOUSE_LABELS, houseParam) ? (houseParam as AuctionHouse) : undefined
  const categoryParam = params.get('category')
  const category = categoryParam && (LOT_CATEGORIES as string[]).includes(categoryParam) ? (categoryParam as LotCategory) : undefined
  const page = Math.max(1, Math.floor(Number(params.get('page') ?? '1')) || 1)
  const search = params.get('q')?.slice(0, 100) || undefined

  const { total, lots } = await container.referenceRepository.listAuctionLots({
    house, category, search, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE,
  })
  return NextResponse.json({ total, page, pageSize: PAGE_SIZE, lots })
}
