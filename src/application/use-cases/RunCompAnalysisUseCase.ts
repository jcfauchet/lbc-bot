import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ICompService } from '@/domain/services/ICompService'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'
import type { IFeedbackRepository } from '@/domain/repositories/IFeedbackRepository'
import type { IListingAvailabilityService } from '@/domain/services/IListingAvailabilityService'
import type { ISelectionRanker, RankingCandidate } from '@/domain/services/ISelectionRanker'
import type { ITriageGuidanceRepository } from '@/domain/repositories/ITriageGuidanceRepository'
import type { IRankingWindowRepository } from '@/domain/repositories/IRankingWindowRepository'
import type { Listing } from '@/domain/entities/Listing'
import { scoreComps, isMassMarketCommon } from '@/domain/services/comp-scoring'
import { hasReplicaSignal, hasKnownDesignerAttribution } from '@/domain/services/listing-signals'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

/** A candidate that survived the free filters, with the image both later stages need. */
interface ShortlistEntry {
  listing: Listing
  imageUrl: string
}

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
   * Number of equal windows the day is cut into. The daily budget accrues one
   * share per window instead of being available in full at midnight: the comp
   * stage runs every 15 minutes, so a whole-day budget was drained by the first
   * runs after 00:00 on whatever happened to be queued, making "was there at
   * 00:15" the real selection criterion. Defaults to 1 (whole-day budget).
   */
  windowsPerDay?: number
  /**
   * A listing whose reverse-image search returns at least this many mass-market
   * retail matches (outnumbering value comps) is a common new product with no
   * resale edge — dropped before it is estimated or notified. The Lens credit is
   * already spent by then (the signal comes from its results), so this buys
   * precision, not budget. 0/unset disables the check.
   */
  massMarketMinMatches?: number
  /**
   * How many candidates are submitted to the ranker. Caps both the model call and
   * the free-filter pass that feeds it. Defaults to 20.
   */
  rankingShortlistSize?: number
}

/** Embeds short listing text to look up similar past feedback. */
export interface ITextEmbedder {
  embed(text: string): Promise<number[]>
}

function startOfDay(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/**
 * Credits available in the window `now` falls into: the day's budget accrues one
 * share per elapsed window, minus what the day already spent. Unspent windows
 * therefore carry over on their own — an abstaining window leaves `usedToday`
 * untouched, so the next window's accrual absorbs it — while a spending spree
 * cannot borrow from windows that have not elapsed yet.
 */
/** 0-based index of the window `now` falls into, counted from the start of its day. */
function windowIndex(windowsPerDay: number, now: Date): number {
  const msPerWindow = 86_400_000 / windowsPerDay
  return Math.floor((now.getTime() - startOfDay(now).getTime()) / msPerWindow)
}

export function windowEntitlement(
  dailyBudget: number,
  windowsPerDay: number,
  usedToday: number,
  now: Date = new Date(),
): number {
  const elapsed = windowIndex(windowsPerDay, now) + 1
  // Clamped to dailyBudget: guards a non-integer windowsPerDay (e.g. 1.5) and a
  // DST fall-back day, where a 25-hour local day can push elapsed past
  // windowsPerDay, both of which would otherwise accrue more than the day allows.
  const accrued = Math.min(Math.floor((dailyBudget * elapsed) / windowsPerDay), dailyBudget)
  return Math.max(0, accrued - usedToday)
}

/**
 * Stable identity of the window `now` falls into, as the ISO timestamp of the
 * window's start: stable within the window, distinct across windows and across
 * days. Shares `windowIndex` with `windowEntitlement` rather than re-deriving the
 * window boundary independently, so the two can never disagree about which
 * window "now" belongs to.
 */
export function currentWindowKey(windowsPerDay: number, now: Date = new Date()): string {
  const msPerWindow = 86_400_000 / windowsPerDay
  const index = windowIndex(windowsPerDay, now)
  return new Date(startOfDay(now).getTime() + index * msPerWindow).toISOString()
}

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
    // Optional: orders the shortlist so the window's credits go to the safest bets
    // rather than to whichever qualified listing sorted first. Unwired or failing,
    // the deterministic score-then-freshness order stands.
    private ranker?: ISelectionRanker,
    private guidanceRepository?: ITriageGuidanceRepository,
    // Optional: marks that the ranker was already consulted for the current
    // window, so a later run in the same 15-minute-cadenced window skips the
    // ranking stage entirely instead of repeating it for a near-certainly
    // identical verdict. Unwired, every run ranks again — today's behaviour.
    private rankingWindowRepository?: IRankingWindowRepository,
  ) {}

  async execute(): Promise<{ processed: number; analyzed: number; ignored: number; expired: number; deferred: number }> {
    // Drop stale candidates first so the (tiny) daily budget only ever goes to
    // listings whose deal can still be bought.
    let expired = 0
    if (this.config.triagedMaxAgeDays !== undefined) {
      expired = await this.listingRepository.ignoreTriagedOlderThan(
        this.config.triagedMaxAgeDays,
        `Annonce trop ancienne (> ${this.config.triagedMaxAgeDays}j), le deal est probablement parti`,
      )
    }

    const now = new Date()
    const windowsPerDay = this.config.windowsPerDay ?? 1
    const usedToday = await this.budgetRepository.countSince(startOfDay())
    const usedThisMonth = await this.budgetRepository.countSince(startOfMonth())
    let remaining = Math.min(
      windowEntitlement(this.config.dailyBudget, windowsPerDay, usedToday, now),
      this.config.monthlyBudget - usedThisMonth,
    )
    if (remaining <= 0) return { processed: 0, analyzed: 0, ignored: 0, expired, deferred: 0 }

    // The ranker already ran for this window: `analyze-and-notify` fires every 15
    // minutes, and abstention (or picking fewer than the entitlement) is normal
    // operation, not an edge case — re-running pass one and the vision call for a
    // near-certainly identical verdict would waste both. Skip straight to the next
    // window's first run instead.
    const windowKey = currentWindowKey(windowsPerDay, now)
    if (
      this.ranker &&
      this.rankingWindowRepository &&
      await this.rankingWindowRepository.wasRanked(windowKey)
    ) {
      return { processed: 0, analyzed: 0, ignored: 0, expired, deferred: 0 }
    }

    // Best score first; freshness breaks ties so a credit never goes to an old
    // listing while an equally-scored fresh one — still buyable — waits.
    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) =>
        (b.triageScore ?? 0) - (a.triageScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime())

    let processed = 0
    let analyzed = 0
    let ignored = 0

    // Pass one: walk the sorted candidates applying the filters that cost nothing,
    // stopping as soon as the shortlist is full. The pool holds several hundred
    // rows, so filtering it whole would mean hundreds of writes and embeddings per
    // run for a handful of credits.
    const shortlistSize = this.config.rankingShortlistSize ?? 20
    // The image URL is carried along: pass one already had to load it to check the
    // listing has a photo at all, and both the ranking call and the comp search
    // need it. Re-querying it twice more per listing would be three round-trips
    // for one row.
    const shortlist: ShortlistEntry[] = []
    for (const listing of candidates) {
      if (shortlist.length >= shortlistSize) break

      const listingText = `${listing.title} ${listing.description ?? ''}`

      // The seller describes this as a look-alike ("dans le style de", "réplique",
      // "ressemble à <designer>"). It is not the genuine piece, so estimating it
      // against comps of the real designer would be misleading.
      if (hasReplicaSignal(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce décrite comme une imitation / "dans le style de"')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // The seller already names a known designer/maker, so the price is aligned
      // with the piece's value: no hidden margin. The strategy targets pieces whose
      // value the seller did not recognise.
      if (hasKnownDesignerAttribution(listingText)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Designer/éditeur déjà nommé par le vendeur (pas de marge cachée)')
        await this.listingRepository.update(listing)
        ignored++
        continue
      }

      // Learn from past feedback: a near-duplicate of a piece already judged "pas
      // intéressant" must not take a shortlist slot. Best-effort — an embedding
      // hiccup must never abort the funnel.
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

      shortlist.push({ listing, imageUrl })
    }

    // Captured before pass two spends any of it: the entitlement this window had
    // coming in, used below to tell a supply shortfall apart from the ranker
    // actually declining to spend a credit.
    const entitlement = remaining

    // Pass two: spend the window's credits on the ranker's picks, best first.
    const picks = await this.pickInOrder(shortlist, windowKey)

    // Picks the availability probe drops before a credit is even spent — tracked
    // separately from `remaining` so the deferred metric below can tell this apart
    // from the ranker declining to spend (finding 2), without capping `remaining`
    // on a drop: that would stop the loop from trying the picks ranked below the
    // dropped one, under-spending the window even when good candidates remain.
    let probeDropped = 0

    for (const { listing, imageUrl } of picks) {
      if (remaining <= 0) break

      // A removed listing means the deal is already gone: don't spend a credit
      // estimating a piece nobody can buy. The probe only trusts a definitive
      // 404/410 — an anti-bot block or network error never skips the listing.
      // Probed here, on picks only: it is one HTTP request per listing.
      if (this.availabilityService && await this.availabilityService.isGone(listing.url)) {
        listing.markAsIgnored()
        listing.setIgnoreReason('Annonce supprimée de LeBonCoin (vendue ou retirée)')
        await this.listingRepository.update(listing)
        ignored++
        probeDropped++
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

    // Credits the ranker declined to spend — as opposed to credits left unspent
    // because the shortlist simply didn't hold enough candidates (supply
    // shortfall) or because picks were dropped by the availability probe further
    // down the pipeline than the ranker's judgement (probeDropped). Non-zero day
    // after day means the ranker itself is too severe; with no ranker wired there
    // is no one to blame, hence the guard.
    const supplyShortfall = Math.max(0, entitlement - shortlist.length)
    const deferred = this.ranker ? Math.max(0, remaining - supplyShortfall - probeDropped) : 0

    return { processed, analyzed, ignored, expired, deferred }
  }

  /**
   * Orders the shortlist by asking the ranker to compare the candidates against
   * each other. Any failure falls back to the incoming deterministic order: losing
   * ranking quality is acceptable, stalling the funnel is not.
   */
  private async pickInOrder(shortlist: ShortlistEntry[], windowKey: string): Promise<ShortlistEntry[]> {
    if (!this.ranker || shortlist.length === 0) return shortlist

    const byId = new Map(shortlist.map((entry) => [entry.listing.id, entry]))
    try {
      const guidance = (await this.guidanceRepository?.getLatest())?.content ?? null
      const candidates: RankingCandidate[] = shortlist.map(({ listing, imageUrl }) => ({
        listingId: listing.id,
        imageUrl,
        title: listing.title,
        priceEur: listing.price.getEuros(),
        description: listing.description,
      }))
      const picks = await this.ranker.rank(candidates, guidance)
      // The only trace of why the window's credits went where they did: without
      // this, a precision regression can never be traced back to a ranking call.
      console.log(
        'Selection ranking picks:',
        picks.map((pick) => ({ listingId: pick.listingId, rank: pick.rank, worthCredit: pick.worthCredit, reason: pick.reason })),
      )
      // The ranker was actually consulted for this window — including a full
      // abstention, which is the whole point of tracking this — so record it
      // before this window is asked again. Not recorded on a thrown/caught
      // ranking call below: a transient 429 must not burn the window's one shot.
      if (this.rankingWindowRepository) {
        await this.rankingWindowRepository.markRanked(windowKey)
      }
      // Ports must not be trusted to dedup themselves: a repeated listingId here
      // would otherwise spend two credits on the same listing.
      const seen = new Set<string>()
      return picks
        .filter((pick) => pick.worthCredit && !seen.has(pick.listingId) && seen.add(pick.listingId))
        .map((pick) => byId.get(pick.listingId))
        .filter((entry): entry is ShortlistEntry => entry !== undefined)
    } catch (err) {
      console.error('Selection ranking failed, falling back to deterministic order:', err)
      return shortlist
    }
  }
}
