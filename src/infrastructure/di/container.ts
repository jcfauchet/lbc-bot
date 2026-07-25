import { PrismaClient } from '@prisma/client'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'

import { PrismaLbcProductListingRepository } from '@/infrastructure/prisma/repositories/PrismaLbcProductListingRepository'
import { PrismaSearchRepository } from '@/infrastructure/prisma/repositories/PrismaSearchRepository'
import { PrismaAiAnalysisRepository } from '@/infrastructure/prisma/repositories/PrismaAiAnalysisRepository'
import { PrismaLbcProductListingImageRepository } from '@/infrastructure/prisma/repositories/PrismaLbcProductListingImageRepository'
import { PrismaNotificationRepository } from '@/infrastructure/prisma/repositories/PrismaNotificationRepository'
import { PrismaLbcProductListingLabelRepository } from '@/infrastructure/prisma/repositories/PrismaLbcProductListingLabelRepository'
import { PrismaTaxonomyRepository } from '@/infrastructure/prisma/repositories/PrismaTaxonomyRepository'
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
import { RunCleanupUseCase } from '@/application/use-cases/RunCleanupUseCase'
import { GetDashboardStatsUseCase } from '@/application/use-cases/GetDashboardStatsUseCase'
import { GetNonNotifiedListingsUseCase } from '@/application/use-cases/GetNonNotifiedListingsUseCase'
import { GetTriageBacklogUseCase } from '@/application/use-cases/GetTriageBacklogUseCase'
import { GetRecentNotifiedListingsUseCase } from '@/application/use-cases/GetRecentNotifiedListingsUseCase'
import { SerpApiLensCompService } from '@/infrastructure/comps/SerpApiLensCompService'
import { GeminiTriageService } from '@/infrastructure/ai/Gemini/GeminiTriageService'
import { OpenAiTriageService } from '@/infrastructure/ai/OpenAi/OpenAiTriageService'
import { FallbackTriageService } from '@/infrastructure/ai/FallbackTriageService'
import { PrismaLensBudgetRepository } from '@/infrastructure/prisma/repositories/PrismaLensBudgetRepository'
import { RunPreFilterUseCase } from '@/application/use-cases/RunPreFilterUseCase'
import { RunTriageUseCase } from '@/application/use-cases/RunTriageUseCase'
import { RunCompAnalysisUseCase } from '@/application/use-cases/RunCompAnalysisUseCase'
import { RunFeedbackLearningUseCase } from '@/application/use-cases/RunFeedbackLearningUseCase'

export class Container {
  private static instance: Container

  public readonly prisma: PrismaClient

  public readonly listingRepository: PrismaLbcProductListingRepository
  public readonly searchRepository: PrismaSearchRepository
  public readonly aiAnalysisRepository: PrismaAiAnalysisRepository
  public readonly listingImageRepository: PrismaLbcProductListingImageRepository
  public readonly notificationRepository: PrismaNotificationRepository
  public readonly listingLabelRepository: PrismaLbcProductListingLabelRepository
  public readonly taxonomyRepository: PrismaTaxonomyRepository
  public readonly feedbackRepository: PrismaFeedbackRepository
  public readonly triageGuidanceRepository: PrismaTriageGuidanceRepository
  public readonly embeddingService: EmbeddingService
  public readonly feedbackLearningService: GeminiFeedbackLearningService

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
  public readonly getDashboardStatsUseCase: GetDashboardStatsUseCase
  public readonly getNonNotifiedListingsUseCase: GetNonNotifiedListingsUseCase
  public readonly getRecentNotifiedListingsUseCase: GetRecentNotifiedListingsUseCase
  public readonly getTriageBacklogUseCase: GetTriageBacklogUseCase

  public readonly compService: SerpApiLensCompService
  public readonly triageService: FallbackTriageService
  public readonly lensBudgetRepository: PrismaLensBudgetRepository
  public readonly runPreFilterUseCase: RunPreFilterUseCase
  public readonly runTriageUseCase: RunTriageUseCase
  public readonly runCompAnalysisUseCase: RunCompAnalysisUseCase
  public readonly runFeedbackLearningUseCase: RunFeedbackLearningUseCase

  private constructor() {
    const openAiApiKey = env.OPENAI_API_KEY ?? 'missing-openai-api-key'
    const geminiApiKey = env.GOOGLE_GEMINI_API_KEY ?? 'missing-google-gemini-api-key'
    const resendApiKey = env.RESEND_API_KEY ?? 'missing-resend-api-key'
    const serpApiKey = env.SERPAPI_KEY ?? 'missing-serpapi-key'

    this.prisma = prisma

    this.listingRepository = new PrismaLbcProductListingRepository(this.prisma)
    this.searchRepository = new PrismaSearchRepository(this.prisma)
    this.aiAnalysisRepository = new PrismaAiAnalysisRepository(this.prisma)
    this.listingImageRepository = new PrismaLbcProductListingImageRepository(this.prisma)
    this.notificationRepository = new PrismaNotificationRepository(this.prisma)
    this.listingLabelRepository = new PrismaLbcProductListingLabelRepository(this.prisma)
    this.taxonomyRepository = new PrismaTaxonomyRepository(this.prisma)
    this.feedbackRepository = new PrismaFeedbackRepository(this.prisma)
    this.triageGuidanceRepository = new PrismaTriageGuidanceRepository(this.prisma)
    this.embeddingService = new EmbeddingService(openAiApiKey)
    this.feedbackLearningService = new GeminiFeedbackLearningService(geminiApiKey)

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

    this.compService = new SerpApiLensCompService(serpApiKey)
    this.triageService = new FallbackTriageService(
      new GeminiTriageService(geminiApiKey),
      new OpenAiTriageService(openAiApiKey),
    )
    this.lensBudgetRepository = new PrismaLensBudgetRepository(this.prisma)

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
        fastTrackDailyExtra: env.FAST_TRACK_DAILY_EXTRA,
        fastTrackMinScore: env.FAST_TRACK_MIN_SCORE,
        fastTrackFreshHours: env.FAST_TRACK_FRESH_HOURS,
      },
      this.feedbackRepository,
      this.embeddingService,
      new LbcListingAvailabilityChecker(),
    )

    this.runListingScrapingUseCase = new RunListingScrapingUseCase(
      this.searchRepository,
      this.listingRepository,
      this.listingImageRepository,
      this.listingSourceApi,
      this.listingSourceScraper
    )

    this.runNotificationUseCase = new RunNotificationUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.notificationRepository,
      this.listingImageRepository,
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
