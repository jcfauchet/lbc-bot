import { PrismaClient } from '@prisma/client'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'

import { PrismaLbcProductListingRepository } from '@/infrastructure/prisma/repositories/PrismaLbcProductListingRepository'
import { PrismaSearchRepository } from '@/infrastructure/prisma/repositories/PrismaSearchRepository'
import { PrismaAiAnalysisRepository } from '@/infrastructure/prisma/repositories/PrismaAiAnalysisRepository'
import { PrismaLbcProductListingImageRepository } from '@/infrastructure/prisma/repositories/PrismaLbcProductListingImageRepository'
import { PrismaNotificationRepository } from '@/infrastructure/prisma/repositories/PrismaNotificationRepository'
import { PrismaFeedbackRepository } from '@/infrastructure/prisma/repositories/PrismaFeedbackRepository'
import { PrismaTriageGuidanceRepository } from '@/infrastructure/prisma/repositories/PrismaTriageGuidanceRepository'
import { EmbeddingService } from '@/infrastructure/ai/EmbeddingService'
import { GeminiFeedbackLearningService } from '@/infrastructure/ai/Gemini/GeminiFeedbackLearningService'

import { LeBonCoinListingScraper } from '@/infrastructure/scraping/listings/LeBonCoinListingScraper'
import { LeBonCoinApiClient } from '@/infrastructure/api/LeBonCoinApiClient'
import { LbcListingAvailabilityChecker } from '@/infrastructure/api/LbcListingAvailabilityChecker'
import { IListingSource } from '@/domain/services/IListingSource'
import { CloudinaryStorageService } from '@/infrastructure/storage/CloudinaryStorageService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { ResendMailer } from '@/infrastructure/mail/ResendMailer'


import { ITextFilterService } from '@/domain/services/ITextFilterService'
import { TextFilterService } from '@/infrastructure/filtering/TextFilterService'

import { RunListingScrapingUseCase } from '@/application/use-cases/RunListingScrapingUseCase'
import { RunNotificationUseCase } from '@/application/use-cases/RunNotificationUseCase'
import { RunWeeklyReportUseCase } from '@/application/use-cases/RunWeeklyReportUseCase'
import { PrismaPipelineTrackingRepository } from '@/infrastructure/prisma/repositories/PrismaPipelineTrackingRepository'
import { RunCleanupUseCase } from '@/application/use-cases/RunCleanupUseCase'
import { GetDashboardStatsUseCase } from '@/application/use-cases/GetDashboardStatsUseCase'
import { GetNonNotifiedListingsUseCase } from '@/application/use-cases/GetNonNotifiedListingsUseCase'
import { GetTriageBacklogUseCase } from '@/application/use-cases/GetTriageBacklogUseCase'
import { GetRecentNotifiedListingsUseCase } from '@/application/use-cases/GetRecentNotifiedListingsUseCase'
import { SerpApiLensCompService } from '@/infrastructure/comps/SerpApiLensCompService'
import { GeminiTriageService } from '@/infrastructure/ai/Gemini/GeminiTriageService'
import { GeminiSelectionRanker } from '@/infrastructure/ai/Gemini/GeminiSelectionRanker'
import { GeminiCompVerifier } from '@/infrastructure/ai/Gemini/GeminiCompVerifier'
import { OpenAiTriageService } from '@/infrastructure/ai/OpenAi/OpenAiTriageService'
import { ClaudeTriageService } from '@/infrastructure/ai/Anthropic/ClaudeTriageService'
import { ClaudeSelectionRanker } from '@/infrastructure/ai/Anthropic/ClaudeSelectionRanker'
import { ClaudeReferenceMatchVerifier } from '@/infrastructure/ai/Anthropic/ClaudeReferenceMatchVerifier'
import { ClaudeFeedbackLearningService } from '@/infrastructure/ai/Anthropic/ClaudeFeedbackLearningService'
import { withFallback } from '@/infrastructure/ai/with-fallback'
import { ClaudeCompVerifier } from '@/infrastructure/ai/Anthropic/ClaudeCompVerifier'
import { ConsensusCompVerifier } from '@/infrastructure/ai/ConsensusCompVerifier'
import { ProductPhotoCompVerifier } from '@/infrastructure/ai/ProductPhotoCompVerifier'

/** Dealer-page photos shown per comparable; each one costs vision tokens on both models. */
const COMP_DEALER_PHOTOS = 2
import type { IFeedbackLearningService } from '@/domain/services/IFeedbackLearningService'
import type { ISelectionRanker } from '@/domain/services/ISelectionRanker'
import type { IReferenceMatchVerifier } from '@/domain/services/IReferenceMatchVerifier'
import { FallbackTriageService } from '@/infrastructure/ai/FallbackTriageService'
import { PrismaLensBudgetRepository } from '@/infrastructure/prisma/repositories/PrismaLensBudgetRepository'
import { PrismaRankingWindowRepository } from '@/infrastructure/prisma/repositories/PrismaRankingWindowRepository'
import { RunPreFilterUseCase } from '@/application/use-cases/RunPreFilterUseCase'
import { RunTriageUseCase } from '@/application/use-cases/RunTriageUseCase'
import { RunCompAnalysisUseCase } from '@/application/use-cases/RunCompAnalysisUseCase'
import { ClaudeAppraisalAgent } from '@/infrastructure/ai/Anthropic/ClaudeAppraisalAgent'
import type { ICompService } from '@/domain/services/ICompService'
import { ApifyLensCompService } from '@/infrastructure/comps/ApifyLensCompService'
import { RunFeedbackLearningUseCase } from '@/application/use-cases/RunFeedbackLearningUseCase'
import { PrismaReferenceRepository } from '@/infrastructure/prisma/repositories/PrismaReferenceRepository'
import { GeminiImageEmbeddingService } from '@/infrastructure/ai/Gemini/GeminiImageEmbeddingService'
import { GeminiReferenceMatchVerifier } from '@/infrastructure/ai/Gemini/GeminiReferenceMatchVerifier'
import { ArtcurialFetcher } from '@/infrastructure/artcurial/ArtcurialFetcher'
import { ArtcurialIngester } from '@/infrastructure/artcurial/ArtcurialIngester'
import { RunReferenceMatchUseCase } from '@/application/use-cases/RunReferenceMatchUseCase'

export class Container {
  private static instance: Container

  public readonly prisma: PrismaClient

  public readonly listingRepository: PrismaLbcProductListingRepository
  public readonly searchRepository: PrismaSearchRepository
  public readonly aiAnalysisRepository: PrismaAiAnalysisRepository
  public readonly listingImageRepository: PrismaLbcProductListingImageRepository
  public readonly notificationRepository: PrismaNotificationRepository
  public readonly feedbackRepository: PrismaFeedbackRepository
  public readonly triageGuidanceRepository: PrismaTriageGuidanceRepository
  public readonly embeddingService: EmbeddingService
  public readonly feedbackLearningService: IFeedbackLearningService

  public readonly scraper: LeBonCoinListingScraper
  public readonly listingSourceApi: IListingSource
  public readonly listingSourceScraper: IListingSource
  public readonly storageService: IStorageService
  public readonly imageDownloadService: ImageDownloadService
  public readonly textFilterService: ITextFilterService
  public readonly mailer: ResendMailer



  public readonly runListingScrapingUseCase: RunListingScrapingUseCase
  public readonly runNotificationUseCase: RunNotificationUseCase
  public readonly runCleanupUseCase: RunCleanupUseCase
  public readonly runWeeklyReportUseCase: RunWeeklyReportUseCase
  public readonly getDashboardStatsUseCase: GetDashboardStatsUseCase
  public readonly getNonNotifiedListingsUseCase: GetNonNotifiedListingsUseCase
  public readonly getRecentNotifiedListingsUseCase: GetRecentNotifiedListingsUseCase
  public readonly getTriageBacklogUseCase: GetTriageBacklogUseCase

  public readonly compService: ICompService
  public readonly triageService: FallbackTriageService
  public readonly lensBudgetRepository: PrismaLensBudgetRepository
  public readonly rankingWindowRepository: PrismaRankingWindowRepository
  public readonly runPreFilterUseCase: RunPreFilterUseCase
  public readonly runTriageUseCase: RunTriageUseCase
  public readonly runCompAnalysisUseCase: RunCompAnalysisUseCase
  public readonly runFeedbackLearningUseCase: RunFeedbackLearningUseCase
  public readonly referenceRepository: PrismaReferenceRepository
  public readonly imageEmbeddingService: GeminiImageEmbeddingService
  public readonly artcurialIngester: ArtcurialIngester
  public readonly runReferenceMatchUseCase: RunReferenceMatchUseCase

  private constructor() {
    const openAiApiKey = env.OPENAI_API_KEY ?? 'missing-openai-api-key'
    const geminiApiKey = env.GOOGLE_GEMINI_API_KEY ?? 'missing-google-gemini-api-key'
    const resendApiKey = env.RESEND_API_KEY ?? 'missing-resend-api-key'
    const serpApiKey = env.SERPAPI_KEY ?? 'missing-serpapi-key'
    const anthropicApiKey = env.ANTHROPIC_API_KEY
    // Claude answers first wherever a key is set, to spend the prepaid monthly
    // Claude budget; Gemini takes over on any error, including the spend limit.
    const claudeFirst = <T extends object>(claude: (key: string) => T, gemini: T, label: string): T =>
      anthropicApiKey ? withFallback(claude(anthropicApiKey), gemini, label) : gemini

    this.prisma = prisma

    this.listingRepository = new PrismaLbcProductListingRepository(this.prisma)
    this.searchRepository = new PrismaSearchRepository(this.prisma)
    this.aiAnalysisRepository = new PrismaAiAnalysisRepository(this.prisma)
    this.listingImageRepository = new PrismaLbcProductListingImageRepository(this.prisma)
    this.notificationRepository = new PrismaNotificationRepository(this.prisma)
    this.feedbackRepository = new PrismaFeedbackRepository(this.prisma)
    this.triageGuidanceRepository = new PrismaTriageGuidanceRepository(this.prisma)
    this.embeddingService = new EmbeddingService(openAiApiKey)
    this.feedbackLearningService = claudeFirst<IFeedbackLearningService>(
      (key) => new ClaudeFeedbackLearningService(key),
      new GeminiFeedbackLearningService(geminiApiKey),
      'Feedback learning',
    )

    this.scraper = new LeBonCoinListingScraper()
    
    // Choose listing source based on environment variable
    this.listingSourceApi = new LeBonCoinApiClient()
    this.listingSourceScraper = new LeBonCoinListingScraper()
    
    this.storageService = new CloudinaryStorageService()
    this.imageDownloadService = new ImageDownloadService(
      this.storageService,
      this.listingImageRepository
    )
    this.textFilterService = new TextFilterService()
    this.mailer = new ResendMailer(resendApiKey)

    this.referenceRepository = new PrismaReferenceRepository(this.prisma)
    this.imageEmbeddingService = new GeminiImageEmbeddingService(geminiApiKey)
    this.artcurialIngester = new ArtcurialIngester(new ArtcurialFetcher(), this.referenceRepository, this.imageEmbeddingService, console.log)
    this.runReferenceMatchUseCase = new RunReferenceMatchUseCase(
      this.referenceRepository,
      this.imageEmbeddingService,
      {
        manual: claudeFirst<IReferenceMatchVerifier>((key) => new ClaudeReferenceMatchVerifier(key), new GeminiReferenceMatchVerifier(geminiApiKey), 'Reference match'),
        auction: new GeminiReferenceMatchVerifier(geminiApiKey),
      },
      this.mailer,
      {
        minSimilarity: env.REFERENCE_MATCH_MIN_SIMILARITY,
        widenSimilarity: env.REFERENCE_MATCH_WIDEN_SIMILARITY,
        maxListingsPerRun: env.REFERENCE_MATCH_MAX_PER_RUN,
        backfillDays: 7,
        emailTo: env.NOTIFICATION_EMAIL_TO,
        emailFrom: env.NOTIFICATION_EMAIL_FROM ?? 'LBC Bot <bot@example.com>',
        // Leaves most of the 800s cron to the deal funnel that runs after it.
        maxRunMs: 120_000,
        // About one auction candidate per ad at the 0.78 similarity gate.
        maxVerificationsPerRun: 40,
        maxCandidatesPerListing: 3,
        maxBackfillPerReference: 15,
        auctionEnabled: env.AUCTION_REFERENCES_ENABLED,
        auctionAlertRatio: env.AUCTION_ALERT_RATIO,
        auctionVerificationsPerDay: env.AUCTION_VERIFICATIONS_PER_DAY,
      },
    )

    // Apify first: several times more Lens searches per dollar than SerpApi, whose
    // free 250/month capped the comp stage at 8 ads a day. SerpApi takes over on
    // any Apify error, including spent credits.
    const serpApi = new SerpApiLensCompService(serpApiKey)
    this.compService = env.APIFY_TOKEN
      ? withFallback<ICompService>(new ApifyLensCompService(env.APIFY_TOKEN), serpApi, 'Lens')
      : serpApi
    const geminiThenOpenAi = new FallbackTriageService(
      // Thinking off: eval:triage on 13 Oct 2026 (200 labelled ads) gave the same
      // precision/recall with and without it, and thinking tokens bill as output.
      new GeminiTriageService(geminiApiKey, { thinkingBudget: 0 }),
      new OpenAiTriageService(openAiApiKey),
    )
    // Claude first: the Anthropic credit is prepaid each month, and eval:triage on
    // 22 Oct 2026 put Haiku 5.5 at 40% precision at threshold 6 vs ~32% for Gemini.
    // Once the monthly spend limit is hit, its errors fall through to Gemini.
    this.triageService = anthropicApiKey
      ? new FallbackTriageService(new ClaudeTriageService(anthropicApiKey), geminiThenOpenAi)
      : geminiThenOpenAi
    this.lensBudgetRepository = new PrismaLensBudgetRepository(this.prisma)
    this.rankingWindowRepository = new PrismaRankingWindowRepository(this.prisma)
    const trackingRepository = new PrismaPipelineTrackingRepository(this.prisma)

    this.runPreFilterUseCase = new RunPreFilterUseCase(
      this.listingRepository,
      this.textFilterService,
      { minEuros: env.MIN_LISTING_PRICE_EUR, maxEuros: env.MAX_LISTING_PRICE_EUR },
    )
    this.runTriageUseCase = new RunTriageUseCase(
      this.listingRepository,
      this.listingImageRepository,
      this.triageService,
      env.TRIAGE_MIN_SCORE,
      env.TRIAGE_MAX_PER_RUN,
      this.triageGuidanceRepository,
    )
    this.runCompAnalysisUseCase = new RunCompAnalysisUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.listingImageRepository,
      this.compService,
      this.lensBudgetRepository,
      {
        dailyBudget: env.LENS_DAILY_BUDGET,
        monthlyBudget: env.LENS_MONTHLY_BUDGET,
        resaleFactor: env.RESALE_REALIZATION_FACTOR,
        similarFeedbackSkipThreshold: env.SIMILAR_FEEDBACK_SKIP_THRESHOLD,
        triagedMaxAgeDays: env.TRIAGED_MAX_AGE_DAYS,
        windowsPerDay: env.LENS_WINDOWS_PER_DAY,
        massMarketMinMatches: env.MASS_MARKET_MIN_MATCHES,
        rankingShortlistSize: env.RANKING_SHORTLIST_SIZE,
        // Three picks at a time keep a window of ~6 Lens searches and appraisals
        // well inside the 800 s cron.
        analysisConcurrency: 3,
      },
      this.feedbackRepository,
      this.embeddingService,
      new LbcListingAvailabilityChecker(),
      env.RANKING_ENABLED && env.GOOGLE_GEMINI_API_KEY
        ? claudeFirst<ISelectionRanker>((key) => new ClaudeSelectionRanker(key), new GeminiSelectionRanker(env.GOOGLE_GEMINI_API_KEY), 'Ranking')
        : undefined,
      this.triageGuidanceRepository,
      this.rankingWindowRepository,
      // Dealer-page photos instead of the blurry Lens thumbnail, then two models that
      // must agree (see ConsensusCompVerifier). Without a Claude key, Gemini alone.
      new ProductPhotoCompVerifier(
        anthropicApiKey
          ? new ConsensusCompVerifier(new ClaudeCompVerifier(anthropicApiKey, 'claude-opus-5-5'), new ClaudeCompVerifier(anthropicApiKey, 'claude-sonnet-5-5'))
          : new GeminiCompVerifier(geminiApiKey),
        COMP_DEALER_PHOTOS,
      ),
      // Sonnet researches each pick from the Lens leads. Backtest on 23 Oct 2026
      // (59 voted ads): 73% 👍 among its margins ≥ 100 € vs 51% for the Lens
      // median, at about 0.07 $ an ad.
      anthropicApiKey && env.APPRAISAL_AGENT_ENABLED ? new ClaudeAppraisalAgent(anthropicApiKey) : undefined,
      trackingRepository,
    )

    this.runListingScrapingUseCase = new RunListingScrapingUseCase(
      this.searchRepository,
      this.listingRepository,
      this.listingImageRepository,
      this.listingSourceApi,
      this.listingSourceScraper,
      env.SCRAPE_MAX_SEARCHES_PER_RUN,
      undefined,
      trackingRepository,
    )

    this.runNotificationUseCase = new RunNotificationUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.notificationRepository,
      this.mailer,
      env.NOTIFICATION_EMAIL_TO,
      env.NOTIFICATION_EMAIL_FROM ?? 'LBC Bot <bot@example.com>',
      env.MIN_MARGIN_IN_EUR,
      0.8,
      // Gate emails on a conservative (worst-case) margin, in cents.
      env.MIN_CONSERVATIVE_MARGIN_IN_EUR * 100,
    )

    this.runCleanupUseCase = new RunCleanupUseCase(
      this.listingRepository,
      14
    )

    this.runWeeklyReportUseCase = new RunWeeklyReportUseCase(
      this.prisma,
      this.mailer,
      env.NOTIFICATION_EMAIL_TO,
      env.NOTIFICATION_EMAIL_FROM ?? 'LBC Bot <bot@example.com>',
    )

    this.getDashboardStatsUseCase = new GetDashboardStatsUseCase(
      this.prisma
    )

    this.getNonNotifiedListingsUseCase = new GetNonNotifiedListingsUseCase(
      this.prisma,
      env.MIN_MARGIN_IN_EUR
    )

    this.getRecentNotifiedListingsUseCase = new GetRecentNotifiedListingsUseCase(
      this.prisma
    )

    this.getTriageBacklogUseCase = new GetTriageBacklogUseCase(this.prisma)

    this.runFeedbackLearningUseCase = new RunFeedbackLearningUseCase(
      this.feedbackRepository,
      this.feedbackLearningService,
      this.triageGuidanceRepository,
      env.FEEDBACK_LEARNING_MAX_ITEMS,
    )
  }

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container()
    }
    return Container.instance
  }

  async cleanup(): Promise<void> {
    await this.scraper.close()
    await this.prisma.$disconnect()
  }
}

export const container = Container.getInstance()
