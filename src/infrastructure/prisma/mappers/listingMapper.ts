import { Listing } from '@/domain/entities/Listing'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'
import { Money } from '@/domain/value-objects/Money'

/**
 * Shared row -> entity mapping for `lbc_product_listings`. Listings are now
 * loaded from more than one repository (a listing also arrives joined to its
 * analysis), so the mapping cannot live inside a single repository anymore.
 */
export function toListingDomain(raw: any): Listing {
  return Listing.fromPersistence({
    id: raw.id,
    lbcId: raw.lbcId,
    searchId: raw.searchId,
    url: raw.url,
    title: raw.title,
    description: raw.description ?? undefined,
    price: Money.fromCents(raw.priceCents),
    city: raw.city,
    region: raw.region,
    publishedAt: raw.publishedAt,
    status: raw.status as ListingStatus,
    ignoreReason: raw.ignoreReason,
    triageScore: raw.triageScore ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  })
}
