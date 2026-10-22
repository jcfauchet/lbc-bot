import type { CompMatch } from '@/domain/services/ICompService'
import type { CompVerifyInput, ICompVerifier } from '@/domain/services/ICompVerifier'
import { fetchProductPhotos } from '@/infrastructure/comps/product-page-photos'
import { compCandidates } from './comp-verify-prompt'

/**
 * Fetches each candidate's dealer-page photos before the check, so the verifier
 * compares real photos instead of the blurry Lens thumbnail. A page that yields
 * nothing leaves that candidate on its thumbnail. Returns the caller's own comp
 * objects, so `confirmed.has(comp)` keeps working upstream.
 */
export class ProductPhotoCompVerifier implements ICompVerifier {
  constructor(
    private readonly inner: ICompVerifier,
    private readonly photosPerComp: number,
    private readonly fetchPhotos: (link: string, max: number) => Promise<string[]> = fetchProductPhotos,
  ) {}

  async verify(input: CompVerifyInput): Promise<CompMatch[]> {
    const shown = new Set(compCandidates(input.comps))
    const enriched = await Promise.all(input.comps.map(async (comp) =>
      shown.has(comp) ? { ...comp, photoUrls: await this.fetchPhotos(comp.link, this.photosPerComp) } : comp))
    // Dealer sites may block the server's IP; this says whether the check still runs on sharp photos.
    const withPhotos = enriched.filter((c) => c.photoUrls?.length).length
    console.log(`Comp check "${input.listingTitle}": dealer photos for ${withPhotos}/${shown.size} comps`)
    const confirmed = new Set(await this.inner.verify({ ...input, comps: enriched }))
    return input.comps.filter((_, i) => confirmed.has(enriched[i]))
  }
}
