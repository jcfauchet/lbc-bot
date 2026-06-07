import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ITriageService } from '@/domain/services/ITriageService'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export class RunTriageUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private imageRepository: IListingImageRepository,
    private triageService: ITriageService,
    private minScore: number,
    private maxPerRun: number,
  ) {}

  async execute(): Promise<{ triaged: number; ignored: number }> {
    // Cap the work per run, newest first, so a fresh scrape batch never blows
    // past the serverless function timeout. The cron runs every 15 min and
    // drains the remainder on subsequent passes.
    const listings = (await this.listingRepository.findByStatus(ListingStatus.PREFILTERED))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, this.maxPerRun)
    let triaged = 0
    let ignored = 0

    for (const listing of listings) {
      const images = await this.imageRepository.findByListingId(listing.id)
      const imageUrl = images[0]?.urlRemote
      if (!imageUrl) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no image for triage')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const { score } = await this.triageService.triage(imageUrl, listing.title)
      if (score >= this.minScore) {
        listing.markAsTriaged(score)
        triaged++
      } else {
        listing.markAsTriaged(score)
        listing.markAsIgnored()
        listing.setIgnoreReason(`triage score ${score} < ${this.minScore}`)
        ignored++
      }
      await this.listingRepository.update(listing)
    }

    return { triaged, ignored }
  }
}
