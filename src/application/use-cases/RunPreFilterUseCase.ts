import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { ITextFilterService } from '@/domain/services/ITextFilterService'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface PriceBounds { minEuros: number; maxEuros: number }

export class RunPreFilterUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private textFilterService: ITextFilterService,
    private bounds: PriceBounds,
  ) {}

  async execute(): Promise<{ prefiltered: number; ignored: number }> {
    const listings = await this.listingRepository.findByStatus(ListingStatus.NEW)
    let prefiltered = 0
    let ignored = 0

    for (const listing of listings) {
      const euros = listing.price.getEuros()
      const filter = this.textFilterService.shouldExclude(listing.title)

      if (filter.exclude) {
        listing.markAsIgnored()
        listing.setIgnoreReason(filter.reason ?? 'text filter')
        await this.listingRepository.update(listing)
        ignored++
      } else if (euros < this.bounds.minEuros || euros > this.bounds.maxEuros) {
        listing.markAsIgnored()
        listing.setIgnoreReason(`price ${euros}€ out of [${this.bounds.minEuros}, ${this.bounds.maxEuros}]`)
        await this.listingRepository.update(listing)
        ignored++
      } else {
        listing.markAsPrefiltered()
        await this.listingRepository.update(listing)
        prefiltered++
      }
    }

    return { prefiltered, ignored }
  }
}
