import type { IListingRepository } from '@/domain/repositories/IListingRepository'
import type { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import type { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import type { ICompService, CompMatch } from '@/domain/services/ICompService'
import type { ICompVerifier } from '@/domain/services/ICompVerifier'
import type { CompCheck } from '@/domain/entities/AiAnalysis'
import type { ILensBudgetRepository } from '@/domain/repositories/ILensBudgetRepository'
import type { IFeedbackRepository } from '@/domain/repositories/IFeedbackRepository'
import type { IListingAvailabilityService } from '@/domain/services/IListingAvailabilityService'
import type { ISelectionRanker, RankingCandidate } from '@/domain/services/ISelectionRanker'
import type { ITriageGuidanceRepository } from '@/domain/repositories/ITriageGuidanceRepository'
import type { IRankingWindowRepository } from '@/domain/repositories/IRankingWindowRepository'
import type { Listing } from '@/domain/entities/Listing'
import { scoreComps, isMassMarketCommon, toEur } from '@/domain/services/comp-scoring'
import type { Appraisal, IAppraisalAgent } from '@/domain/services/IAppraisalAgent'
import type { IPipelineTrackingRepository } from '@/domain/repositories/IPipelineTrackingRepository'
import { hasReplicaSignal, hasKnownDesignerAttribution } from '@/domain/services/listing-signals'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { Money } from '@/domain/value-objects/Money'
import { ListingStatus } from '@/domain/value-objects/ListingStatus'

/** Listings scraped within this window outrank the older backlog whatever their score. */
const FRESH_PRIORITY_MS = 24 * 60 * 60 * 1000

/** A candidate that survived the free filters, with the image both later stages need. */
interface ShortlistEntry {
  listing: Listing
  /** Cover photo: what Lens searches on and the ranker sees. */
  imageUrl: string
  /** Every photo, cover first, for the comp check. */
  imageUrls: string[]
}

/** Shared by the concurrent pick workers of one window. */
interface PickCounters {
  /** Credits still unreserved in this window. */
  remaining: number
  processed: number
  analyzed: number
  ignored: number
  probeDropped: number
}

/** An agent analysis rests on inspected same-model comps: it clears the 0.8 email gate. */
const AGENT_CONFIDENCE = 0.9

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
  /** Picks analysed at once within a window. Defaults to 1 (one after another). */
  analysisConcurrency?: number
}

const MIN_DISTINCTIVE_TITLE_WORDS = 4

function isDistinctiveTitle(title: string): boolean {
  return title.trim().split(/\s+/).length >= MIN_DISTINCTIVE_TITLE_WORDS
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
    // Optional: looks at the ad photos next to each priced comparable and says
    // which ones show the same model. Reverse-image search returns look-alikes,
    // and a look-alike priced the piece as if it were the real thing. The check
    // qualifies the analysis (badge in the email, numbers in the table); it does
    // not change the estimate yet. Failing, the analysis is saved unchecked.
    private compVerifier?: ICompVerifier,
    // Optional: researches each pick like an expert, starting from the Lens matches,
    // and prices it only from the same-model comparables it inspected itself. When
    // wired it replaces the Lens-median estimate and the comp check; it falls back
    // to them only when it fails outright.
    private appraisalAgent?: IAppraisalAgent,
    // Optional: one row per agent run, kept even when the listing is then ignored,
    // so the weekly report can show cost per email and the zero-comp rate.
    private trackingRepository?: IPipelineTrackingRepository,
  ) {}

  private async checkComps(listingImageUrls: string[], listingTitle: string, matches: CompMatch[]): Promise<CompCheck | undefined> {
    if (!this.compVerifier) return undefined
    const candidates = matches.filter((m) => m.isValueDomain && m.price)
    if (candidates.length === 0) return undefined
    try {
      const confirmed = new Set(await this.compVerifier.verify({ listingImageUrls, listingTitle, comps: candidates }))
      const checked = candidates.map((m) => ({
        title: m.title, link: m.link, source: m.source, priceEur: m.price?.value, imageUrl: m.imageUrl,
        confirmed: confirmed.has(m),
      }))
      return { candidates: checked, confirmedCount: checked.filter((c) => c.confirmed).length }
    } catch (err) {
      console.error(`Comp verification failed for ${listingTitle}:`, err)
      return undefined
    }
  }

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
    const remaining = Math.min(
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

    // Listings scraped in the last day come first, then best score, then freshness.
    // Scores saturate at 7-9, so score-first let the deferred backlog fill the
    // shortlist: on 23 Oct 2026 the ranker picked 4-day-old ads, one already sold.
    const freshSince = now.getTime() - FRESH_PRIORITY_MS
    const candidates = (await this.listingRepository.findByStatus(ListingStatus.TRIAGED))
      .sort((a, b) =>
        Number(b.createdAt.getTime() >= freshSince) - Number(a.createdAt.getTime() >= freshSince) ||
        (b.triageScore ?? 0) - (a.triageScore ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime())

    // Nothing reached TRIAGED since the last ranking: the ranker would see the
    // shortlist it already judged, so the Opus call is skipped and the window left
    // unmarked — a listing triaged later in the window still gets ranked.
    if (this.ranker && this.rankingWindowRepository) {
      try {
        const lastRankedAt = await this.rankingWindowRepository.lastRankedAt()
        if (lastRankedAt && candidates.every((l) => l.updatedAt <= lastRankedAt)) {
          return { processed: 0, analyzed: 0, ignored: 0, expired, deferred: 0 }
        }
      } catch (err) {
        console.error('Last ranking lookup failed, ranking anyway:', err)
      }
    }

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

      // A repost of a piece already judged "pas intéressant": new lbcId, same
      // title. The vector check below misses these because the feedback embedding
      // covers the title plus the AI estimate, not the seller's description.
      // Short titles ("Table basse vintage") are shared by unrelated pieces voted
      // both ways, so only a distinctive title counts as the same listing.
      if (this.feedbackRepository && isDistinctiveTitle(listing.title)) {
        try {
          const rejected = await this.feedbackRepository.findRejectedByTitle(listing.title)
          if (rejected) {
            listing.markAsIgnored()
            const why = rejected.comment ? ` ("${rejected.comment}")` : ''
            listing.setIgnoreReason(`Republication d'une annonce déjà jugée sans intérêt${why}`)
            await this.listingRepository.update(listing)
            ignored++
            continue
          }
        } catch (err) {
          console.error(`Repost check failed for ${listing.id}:`, err)
        }
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

      shortlist.push({ listing, imageUrl, imageUrls: images.map((i) => i.urlRemote) })
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
    const run: PickCounters = { remaining, processed: 0, analyzed: 0, ignored: 0, probeDropped: 0 }

    // Several picks at once: a Lens search plus an agent appraisal take a minute or
    // two each, and a window's picks one after another would outlast the cron.
    const queue = [...picks]
    const worker = async (): Promise<void> => {
      for (let pick = queue.shift(); pick; pick = queue.shift()) {
        // The credit is reserved before the first await, so concurrent workers can
        // never spend more than the window holds; analyzePick refunds a dropped pick.
        if (run.remaining <= 0) return
        run.remaining--
        await this.analyzePick(pick, run)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, this.config.analysisConcurrency ?? 1) }, worker))

    // Credits the ranker declined to spend — as opposed to credits left unspent
    // because the shortlist simply didn't hold enough candidates (supply
    // shortfall) or because picks were dropped by the availability probe further
    // down the pipeline than the ranker's judgement (probeDropped). Non-zero day
    // after day means the ranker itself is too severe; with no ranker wired there
    // is no one to blame, hence the guard.
    const supplyShortfall = Math.max(0, entitlement - shortlist.length)
    const deferred = this.ranker ? Math.max(0, run.remaining - supplyShortfall - run.probeDropped) : 0

    return { processed: run.processed, analyzed: run.analyzed, ignored: ignored + run.ignored, expired, deferred }
  }

  /** One pick, its credit already reserved in `run.remaining`. */
  private async analyzePick({ listing, imageUrl, imageUrls }: ShortlistEntry, run: PickCounters): Promise<void> {
    const ignore = async (reason: string) => {
      listing.markAsIgnored()
      listing.setIgnoreReason(reason)
      await this.listingRepository.update(listing)
      run.ignored++
    }

    // A removed listing means the deal is already gone: don't spend a credit
    // estimating a piece nobody can buy. The probe only trusts a definitive
    // 404/410 — an anti-bot block or network error never skips the listing.
    // Probed here, on picks only: it is one HTTP request per listing.
    if (this.availabilityService && await this.availabilityService.isGone(listing.url)) {
      run.remaining++
      run.probeDropped++
      await ignore('Annonce supprimée de LeBonCoin (vendue ou retirée)')
      return
    }

    run.processed++
    let comps
    try {
      comps = await this.compService.findComps(imageUrl)
      await this.budgetRepository.recordCall(listing.id, true)
    } catch (err) {
      await this.budgetRepository.recordCall(listing.id, false)
      console.error(`Comp search failed for ${listing.id}:`, err)
      return
    }

    // The image matches many mass-market retail listings: the piece is a common
    // new product ("trouvé neuf sur les marketplaces", "personne n'achète"), so
    // there is no resale edge even if a stray value comp exists.
    if (isMassMarketCommon(comps.matches, this.config.massMarketMinMatches ?? 0)) {
      await ignore('Objet trop commun (vendu neuf sur les marketplaces), pas de marge de revente')
      return
    }

    const appraisal = await this.appraise(listing, imageUrls, comps.matches)
    const analysis = appraisal === undefined
      ? await this.lensAnalysis(listing, imageUrls, comps.matches)
      : this.agentAnalysis(listing, appraisal)
    if (typeof analysis === 'string') {
      await ignore(analysis)
      return
    }
    await this.aiAnalysisRepository.save(analysis)
    listing.markAsAnalyzed()
    await this.listingRepository.update(listing)
    run.analyzed++
  }

  /** The agent's appraisal with the Lens matches as leads; undefined when no agent is wired or it failed. */
  private async appraise(listing: Listing, imageUrls: string[], leads: CompMatch[]): Promise<Appraisal | undefined> {
    if (!this.appraisalAgent) return undefined
    try {
      const appraisal = await this.appraisalAgent.appraise({
        title: listing.title, description: listing.description, priceEur: listing.price.getEuros(), imageUrls, leads,
      })
      const { turns, webSearches, pagesInspected, usd } = appraisal.cost
      console.log(`Appraisal "${listing.title}": ${appraisal.comps.length} same-model comps`
        + ` (${turns} turns, ${webSearches} searches, ${pagesInspected} pages, ${usd.toFixed(3)} $) — ${appraisal.identification}`)
      await this.trackingRepository?.recordAppraisalRun({
        listingId: listing.id, compCount: appraisal.comps.length, turns, costUsd: usd,
      }).catch((err) => console.error(`Appraisal run tracking failed for ${listing.id}:`, err))
      return appraisal
    } catch (err) {
      console.error(`Appraisal agent failed for ${listing.id}, falling back to Lens scoring:`, err)
      return undefined
    }
  }

  /**
   * Priced from the comparables the agent inspected and vouched for. None found
   * means no estimate at all: on the 23 Oct 2026 backtest, the Lens estimate for
   * the ads the agent could not price was no better than chance.
   */
  private agentAnalysis(listing: Listing, appraisal: Appraisal): AiAnalysis | string {
    const identified = appraisal.identification ? `: ${appraisal.identification}` : ''
    if (appraisal.comps.length === 0) return `No same-model comparable found${identified}`.slice(0, 500)
    const score = scoreComps(appraisal.comps)
    if (score.estimatedValueEur === null) return `No priced same-model comparable${identified}`.slice(0, 500)

    const resaleFactor = this.config.resaleFactor ?? 1
    const estMin = Money.fromEuros(score.rangeMinEur! * resaleFactor)
    const estMax = Money.fromEuros(score.rangeMaxEur! * resaleFactor)
    const median = Money.fromEuros(score.estimatedValueEur * resaleFactor)
    const candidates = appraisal.comps.map((c) => ({
      title: c.title, link: c.link, source: c.source, priceEur: c.price ? toEur(c.price.value, c.price.currency) : undefined,
      imageUrl: c.photoUrls?.[0] ?? c.imageUrl, confirmed: true,
    }))
    return AiAnalysis.create({
      listingId: listing.id,
      estimatedMinPrice: estMin,
      estimatedMaxPrice: estMax,
      margin: median.minus(listing.price),
      description: `${appraisal.identification}. Realistic resale ${median.getEuros()}€ (dealer median ${score.estimatedValueEur}€ ×${resaleFactor}) from ${score.pricedCompCount} same-model comps. Range ${estMin.getEuros()}–${estMax.getEuros()}€. ${appraisal.notes}`,
      // Every comp was inspected and judged the same model, which is the evidence
      // the Lens confidence levels approximate with comp counts.
      confidence: AGENT_CONFIDENCE,
      provider: this.appraisalAgent!.providerName,
      bestMatchSource: appraisal.comps[0].link,
      searchTerms: [],
      compCheck: { candidates, confirmedCount: candidates.length },
    })
  }

  /** The original estimate: every priced value comp Lens returned, look-alikes included. */
  private async lensAnalysis(listing: Listing, imageUrls: string[], matches: CompMatch[]): Promise<AiAnalysis | string> {
    const score = scoreComps(matches)
    if (score.estimatedValueEur === null) return 'no priced value comps'

    const resaleFactor = this.config.resaleFactor ?? 1
    const estMin = Money.fromEuros(score.rangeMinEur! * resaleFactor)
    const estMax = Money.fromEuros(score.rangeMaxEur! * resaleFactor)
    const median = Money.fromEuros(score.estimatedValueEur * resaleFactor)
    const topComp = matches.find((m) => m.isValueDomain && m.price)?.link
    const compCheck = await this.checkComps(imageUrls, listing.title, matches)

    return AiAnalysis.create({
      listingId: listing.id,
      estimatedMinPrice: estMin,
      estimatedMaxPrice: estMax,
      margin: median.minus(listing.price),
      description: `Realistic resale ${median.getEuros()}€ (dealer median ${score.estimatedValueEur}€ ×${resaleFactor}) from ${score.pricedCompCount} value comps (${score.confidence}). Range ${estMin.getEuros()}–${estMax.getEuros()}€.`,
      confidence: score.confidence === 'reliable' ? 0.9 : 0.6,
      provider: this.compService.providerName,
      bestMatchSource: topComp ?? undefined,
      searchTerms: [],
      compCheck,
    })
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
      // before this window is asked again. Own try/catch, deliberately outside
      // the ranking try/catch below: a marker-write failure (DB pool timeout,
      // the table not existing yet) has nothing to do with the ranking call
      // that just succeeded, and must not be swallowed by the catch further
      // down — that catch discards the ranker's verdict and falls back to
      // spending on listings the ranker explicitly declined, which is exactly
      // the precision regression this feature exists to prevent. Worst case
      // of a marker-write failure: the window goes unmarked and ranks again
      // on the next 15-minute tick — the pre-fix behaviour, and strictly
      // better than discarding a valid verdict.
      if (this.rankingWindowRepository) {
        try {
          await this.rankingWindowRepository.markRanked(windowKey)
        } catch (err) {
          console.error(`Failed to record the ranking window marker for ${windowKey} (ranking itself succeeded):`, err)
        }
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
