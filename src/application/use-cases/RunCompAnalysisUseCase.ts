import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ICompService } from '@/domain/services/ICompService'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'
import { scoreComps } from '@/domain/services/comp-scoring'
import { hasReplicaSignal, hasKnownDesignerAttribution } from '@/domain/services/listing-signals'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

export interface LensBudgetConfig {
  dailyBudget: number
  monthlyBudget: number
  /**
   * Converts dealer asking prices (the comps come from 1stdibs/Selency/Chairish)
   * into a realistic quick-resale value. Dealers ask 1.5-3x what a fast flip
   * actually fetches, which is why deals kept reading as "trop cher pour la
   * revente". Defaults to 1 (no discount) when unset.
   */
  resaleFactor?: number
}

function startOfDay(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
function startOfMonth(): Date { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) }

export class RunCompAnalysisUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private imageRepository: IListingImageRepository,
    private compService: ICompService,
    private budgetRepository: ILensBudgetRepository,
    private config: LensBudgetConfig,
  ) {}

  async execute(): Promise<{ processed: number; analyzed: number; ignored: number }> {
    const usedToday = await this.budgetRepository.countSince(startOfDay())
    const usedThisMonth = await this.budgetRepository.countSince(startOfMonth())
    let remaining = Math.min(this.config.dailyBudget - usedToday, this.config.monthlyBudget - usedThisMonth)
    if (remaining <= 0) return { processed: 0, analyzed: 0, ignored: 0 }

    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) => (b.triageScore ?? 0) - (a.triageScore ?? 0))

    let processed = 0
    let analyzed = 0
    let ignored = 0

    for (const listing of candidates) {
      if (remaining <= 0) break

      // The seller describes this as a look-alike ("dans le style de", "réplique",
      // "ressemble à <designer>"). It is not the genuine piece, so estimating it
      // against comps of the real designer would be misleading. Drop it before
      // spending a (paid) reverse-image-search credit.
      const listingText = `${listing.title} ${listing.description ?? ''}`
      if (hasReplicaSignal(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce décrite comme une imitation / "dans le style de"')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // The seller already names a known designer/maker, so the price is aligned
      // with the piece's value: no hidden margin. The strategy targets pieces
      // whose value the seller did not recognise. Skip before spending a credit.
      if (hasKnownDesignerAttribution(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Designer/éditeur déjà nommé par le vendeur (pas de marge cachée)')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const images = await this.imageRepository.findByListingId(listing.id)
      const imageUrl = images[0]?.urlRemote
      if (!imageUrl) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no image for comp search')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      remaining--
      processed++
      let comps
      try {
        comps = await this.compService.findComps(imageUrl)
        await this.budgetRepository.recordCall(listing.id, true)
      } catch (err) {
        await this.budgetRepository.recordCall(listing.id, false)
        console.error(`Comp search failed for ${listing.id}:`, err)
        continue
      }

      const score = scoreComps(comps.matches)
      if (score.estimatedValueEur === null) {
        listing.markAsIgnored()
        listing.setIgnoreReason('no priced value comps')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      const resaleFactor = this.config.resaleFactor ?? 1
      const estMin = Money.fromEuros(score.rangeMinEur! * resaleFactor)
      const estMax = Money.fromEuros(score.rangeMaxEur! * resaleFactor)
      const median = Money.fromEuros(score.estimatedValueEur * resaleFactor)
      const topComp = comps.matches.find((m) => m.isValueDomain && m.price)?.link

      const analysis = AiAnalysis.create({
        listingId: listing.id,
        estimatedMinPrice: estMin,
        estimatedMaxPrice: estMax,
        margin: median.minus(listing.price),
        description: `Realistic resale ${median.getEuros()}€ (dealer median ${score.estimatedValueEur}€ ×${resaleFactor}) from ${score.pricedCompCount} value comps (${score.confidence}). Range ${estMin.getEuros()}–${estMax.getEuros()}€.`,
        confidence: score.confidence === 'reliable' ? 0.9 : 0.6,
        provider: this.compService.providerName,
        bestMatchSource: topComp ?? undefined,
        searchTerms: [],
      })
      await this.aiAnalysisRepository.save(analysis)
      listing.markAsAnalyzed()
      await this.listingRepository.update(listing)
      analyzed++
    }

    return { processed, analyzed, ignored }
  }
}
