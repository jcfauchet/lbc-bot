import type { AuctionHouse } from '@/domain/auction-houses'
import type { IReferenceRepository } from '@/domain/repositories/IReferenceRepository'
import type { IImageEmbeddingService } from '@/domain/services/IImageEmbeddingService'
import { AderAdapter } from '@/infrastructure/ader/AderAdapter'
import { ArtcurialAdapter } from '@/infrastructure/artcurial/ArtcurialAdapter'
import type { PageFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import { AuctionIngester } from '@/infrastructure/auction/AuctionIngester'
import type { HouseAdapter } from '@/infrastructure/auction/HouseAdapter'
import { DrouotPlatformAdapter } from '@/infrastructure/drouot/DrouotPlatformAdapter'
import { DROUOT_HOUSES } from '@/infrastructure/drouot/house-configs'

export interface AuctionIngesterDeps {
  /** One fetcher serves every house: per-URL timeout, one retry (after 5 s on 429), nothing house-specific. */
  fetcher: PageFetcher
  repo: IReferenceRepository
  embedder: IImageEmbeddingService
  log: (line: string) => void
}

/** One ingester per auction house, each on its house's adapter. */
export function buildAuctionIngesters({ fetcher, repo, embedder, log }: AuctionIngesterDeps): Record<AuctionHouse, AuctionIngester> {
  const ingester = (adapter: HouseAdapter) => new AuctionIngester(adapter, repo, embedder, log)
  const drouot = (house: keyof typeof DROUOT_HOUSES) => ingester(new DrouotPlatformAdapter(DROUOT_HOUSES[house], fetcher, log))
  return {
    ARTCURIAL: ingester(new ArtcurialAdapter(fetcher, log)),
    ROSSINI: drouot('ROSSINI'),
    OSENAT: drouot('OSENAT'),
    PBA: drouot('PBA'),
    GROS_DELETTREZ: drouot('GROS_DELETTREZ'),
    ADER: ingester(new AderAdapter(fetcher, log)),
  }
}
