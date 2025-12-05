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

import { LeBonCoinListingScraper } from '@/infrastructure/scraping/listings/LeBonCoinListingScraper'
// import { AuctionFrScraper } from '@/infrastructure/scraping/reference/AuctionFr/AuctionFrScraper' // Disabled: Cloudflare challenge too difficult to bypass
// import { PamonoScraper } from '@/infrastructure/scraping/reference/Pamono/PamonoScraper'
// import { SelencyScraper } from '@/infrastructure/scraping/reference/Selency/SelencyScraper'
// import { FirstDibsScraper } from '@/infrastructure/scraping/reference/FirstDibsScraper/FirstDibsScraper'
// import { GoogleImageScraper } from '@/infrastructure/scraping/reference/Google/GoogleImageScraper'
import { GoogleCustomSearchScraper } from '@/infrastructure/scraping/reference/Google/GoogleCustomSearchScraper'
import { IReferenceScraper } from '@/infrastructure/scraping/reference/IReferenceScraper'
import { LeBonCoinApiClient } from '@/infrastructure/api/LeBonCoinApiClient'
import { IListingSource } from '@/domain/services/IListingSource'
import { LocalStorageService } from '@/infrastructure/storage/LocalStorageService'
import { CloudinaryStorageService } from '@/infrastructure/storage/CloudinaryStorageService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { OpenAiPriceEstimationService } from '@/infrastructure/ai/OpenAi/OpenAiPriceEstimationService'
import { ResendMailer } from '@/infrastructure/mail/ResendMailer'


import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'

import { RunListingScrapingUseCase } from '@/application/use-cases/RunListingScrapingUseCase'
import { RunAiAnalysisUseCase } from '@/application/use-cases/RunAiAnalysisUseCase'
import { RunNotificationUseCase } from '@/application/use-cases/RunNotificationUseCase'
import { RunCleanupUseCase } from '@/application/use-cases/RunCleanupUseCase'
import { GetDashboardStatsUseCase } from '@/application/use-cases/GetDashboardStatsUseCase'
import { GetNonNotifiedListingsUseCase } from '@/application/use-cases/GetNonNotifiedListingsUseCase'
import { GeminiPriceEstimationService } from '@/infrastructure/ai/Gemini/GeminiPriceEstimationService'

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

  public readonly scraper: LeBonCoinListingScraper
  public readonly listingSourceApi: IListingSource
  public readonly listingSourceScraper: IListingSource
  public readonly storageService: IStorageService
  public readonly imageDownloadService: ImageDownloadService
  public readonly priceEstimationService: IPriceEstimationService
  public readonly mailer: ResendMailer



  public readonly runListingScrapingUseCase: RunListingScrapingUseCase
  public readonly runAiAnalysisUseCase: RunAiAnalysisUseCase
  public readonly runNotificationUseCase: RunNotificationUseCase
  public readonly runCleanupUseCase: RunCleanupUseCase
  public readonly getDashboardStatsUseCase: GetDashboardStatsUseCase
  public readonly getNonNotifiedListingsUseCase: GetNonNotifiedListingsUseCase

  private constructor() {
    this.prisma = prisma

    this.listingRepository = new PrismaLbcProductListingRepository(this.prisma)
    this.searchRepository = new PrismaSearchRepository(this.prisma)
    this.aiAnalysisRepository = new PrismaAiAnalysisRepository(this.prisma)
    this.listingImageRepository = new PrismaLbcProductListingImageRepository(this.prisma)
    this.notificationRepository = new PrismaNotificationRepository(this.prisma)
    this.listingLabelRepository = new PrismaLbcProductListingLabelRepository(this.prisma)
    this.taxonomyRepository = new PrismaTaxonomyRepository(this.prisma)

    this.scraper = new LeBonCoinListingScraper()
    
    // Choose listing source based on environment variable
    this.listingSourceApi = new LeBonCoinApiClient()
    this.listingSourceScraper = new LeBonCoinListingScraper()
    
    this.storageService = env.STORAGE_TYPE === 'cloudinary'
      ? new CloudinaryStorageService()
      : new LocalStorageService(env.STORAGE_LOCAL_PATH)
    this.imageDownloadService = new ImageDownloadService(
      this.storageService,
      this.listingImageRepository
    )
    this.priceEstimationService = env.AI_PROVIDER === 'openai' ? new OpenAiPriceEstimationService(
      env.OPENAI_API_KEY,
      this.storageService
    ) : new GeminiPriceEstimationService(
      env.GOOGLE_GEMINI_API_KEY,
      this.storageService
    )
    
    this.mailer = new ResendMailer(env.RESEND_API_KEY)

    this.runListingScrapingUseCase = new RunListingScrapingUseCase(
      this.searchRepository,
      this.listingRepository,
      this.listingImageRepository,
      this.listingSourceApi,
      this.listingSourceScraper
    )

    const referenceScrapers: Map<string, IReferenceScraper> = new Map()
    // referenceScrapers.set('AuctionFR', new AuctionFrScraper()) // Disabled: Cloudflare challenge too difficult to bypass automatically
    // referenceScrapers.set('Pamono', new PamonoScraper())
    // referenceScrapers.set('1stdibs', new FirstDibsScraper())
    // referenceScrapers.set('Selency', new SelencyScraper())

    const googleImageScraper = new GoogleCustomSearchScraper()

    this.runAiAnalysisUseCase = new RunAiAnalysisUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.listingImageRepository,
      this.priceEstimationService,
      this.imageDownloadService,
      this.storageService,
      referenceScrapers,
      this.taxonomyRepository,
      googleImageScraper
    )

    this.runNotificationUseCase = new RunNotificationUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.notificationRepository,
      this.listingImageRepository,
      this.mailer,
      env.NOTIFICATION_EMAIL_TO,
      env.NOTIFICATION_EMAIL_FROM,
      env.MIN_MARGIN_IN_EUR
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

