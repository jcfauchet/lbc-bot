import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ICompService } from '@/domain/services/ICompService'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'
import type { IFeedbackRepository } from '@/domain/repositories/IFeedbackRepository'
import type { IListingAvailabilityService } from '@/domain/services/IListingAvailabilityService'
import { scoreComps, isMassMarketCommon } from '@/domain/services/comp-scoring'
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
  /**
   * Cosine-similarity threshold (0-1) above which a candidate is treated as a
   * near-duplicate of a piece the user already rejected, and skipped before
   * spending a paid comp credit. High by design: only near-identical matches
   * should short-circuit, to avoid dropping genuine deals. Defaults to 0.92.
   */
  similarFeedbackSkipThreshold?: number
  /**
   * TRIAGED listings older than this are bulk-expired before picking comp
   * candidates: vintage deals are gone within days, and 90% of the backlog was
   * observed to be older than a week — pure comp-credit waste. Unset = no expiry.
   */
  triagedMaxAgeDays?: number
  /**
   * Fast-track lane: a fresh, high-scored listing is a live deal that must not
   * wait for tomorrow's budget reset. Eligible listings jump the queue and may
   * spend up to `fastTrackDailyExtra` credits beyond the daily budget (the
   * monthly budget is always enforced). Extra of 0/unset disables the bonus;
   * queue-jumping still applies.
   */
  fastTrackDailyExtra?: number
  /** Minimum triage score for the fast-track lane. Defaults to 9. */
  fastTrackMinScore?: number
  /** Maximum listing age (hours) for the fast-track lane. Defaults to 24. */
  fastTrackFreshHours?: number
  /**
   * A listing whose reverse-image search returns at least this many mass-market
   * retail matches (outnumbering value comps) is a common new product with no
   * resale edge — dropped before it is estimated or notified. The Lens credit is
   * already spent by then (the signal comes from its results), so this buys
   * precision, not budget. 0/unset disables the check.
   */
  massMarketMinMatches?: number
}

/** Embeds short listing text to look up similar past feedback. */
export interface ITextEmbedder {
  embed(text: string): Promise<number[]>
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
    // Optional: when both are wired, the candidate is checked against past
    // feedback so pieces the user already rejected don't burn a comp credit again.
    private feedbackRepository?: IFeedbackRepository,
    private embedder?: ITextEmbedder,
    // Optional: probes whether the listing is still online before spending a credit.
    private availabilityService?: IListingAvailabilityService,
  ) {}

  async execute(): Promise<{ processed: number; analyzed: number; ignored: number; expired: number }> {
    // Drop stale candidates first so the (tiny) daily budget only ever goes to
    // listings whose deal can still be bought.
    let expired = 0
    if (this.config.triagedMaxAgeDays !== undefined) {
      expired = await this.listingRepository.ignoreTriagedOlderThan(
        this.config.triagedMaxAgeDays,
        `Annonce trop ancienne (> ${this.config.triagedMaxAgeDays}j), le deal est probablement parti`,
      )
    }

    const usedToday = await this.budgetRepository.countSince(startOfDay())
    const usedThisMonth = await this.budgetRepository.countSince(startOfMonth())
    const fastTrackExtra = this.config.fastTrackDailyExtra ?? 0
    // Standard candidates stop at the daily budget; fast-track ones may dig
    // into the extra. The monthly budget caps both.
    let remaining = Math.min(this.config.dailyBudget - usedToday, this.config.monthlyBudget - usedThisMonth)
    let remainingWithBonus = Math.min(
      this.config.dailyBudget + fastTrackExtra - usedToday,
      this.config.monthlyBudget - usedThisMonth,
    )
    if (remainingWithBonus <= 0) return { processed: 0, analyzed: 0, ignored: 0, expired }

    // Fast-track lane first (a fresh gem must not wait for tomorrow's budget),
    // then best score first; freshness breaks ties so a credit never goes to an
    // old listing while an equally-scored fresh one (still buyable) waits.
    const isFastTrack = (l: { triageScore?: number; createdAt: Date }): boolean =>
      (l.triageScore ?? 0) >= (this.config.fastTrackMinScore ?? 9) &&
      Date.now() - l.createdAt.getTime() <= (this.config.fastTrackFreshHours ?? 24) * 3_600_000
    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) =>
        Number(isFastTrack(b)) - Number(isFastTrack(a)) ||
        (b.triageScore ?? 0) - (a.triageScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime())

    let processed = 0
    let analyzed = 0
    let ignored = 0

    for (const listing of candidates) {
      // Fast-track candidates are sorted first, so once the bonus budget is
      // gone — or the standard budget for a non-fast-track listing — we stop.
      if ((isFastTrack(listing) ? remainingWithBonus : remaining) <= 0) break

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

      // A removed listing means the deal is already gone: don't spend a credit
      // estimating a piece nobody can buy. The probe only trusts a definitive
      // 404/410 — an anti-bot block or network error never skips the listing.
      if (this.availabilityService && await this.availabilityService.isGone(listing.url)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce supprimée de LeBonCoin (vendue ou retirée)')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // Learn from past feedback: if this piece is a near-duplicate of one the
      // user already judged "pas intéressant", skip it before spending a (paid)
      // comp credit. Best-effort — an embedding hiccup must never abort the funnel.
      if (this.feedbackRepository && this.embedder) {
        try {
          const embedding = await this.embedder.embed(listingText)
          const [closest] = await this.feedbackRepository.findSimilar(embedding, 1)
          const threshold = this.config.similarFeedbackSkipThreshold ?? 0.92
          if (closest && !closest.isGood && closest.similarity >= threshold) {
            listing.markAsIgnored()
            const why = closest.comment ? ` ("${closest.comment}")` : ''
            listing.setIgnoreReason(`Similaire à une annonce déjà jugée sans intérêt${why}`)
            await this.listingRepository.update(listing)
            ignored++
            continue
          }
        } catch (err) {
          console.error(`Similar-feedback check failed for ${listing.id}:`, err)
        }
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
      remainingWithBonus--
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

      // The image matches many mass-market retail listings: the piece is a common
      // new product ("trouvé neuf sur les marketplaces", "personne n'achète"), so
      // there is no resale edge even if a stray value comp exists.
      if (isMassMarketCommon(comps.matches, this.config.massMarketMinMatches ?? 0)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Objet trop commun (vendu neuf sur les marketplaces), pas de marge de revente')
        await this.listingRepository.update(listing)
        ignored++
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

    return { processed, analyzed, ignored, expired }
  }
}
