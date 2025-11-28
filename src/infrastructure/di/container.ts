import { PrismaClient } from '@prisma/client'
import { prisma } from '@/infrastructure/prisma/client'
import { env } from '@/infrastructure/config/env'

import { PrismaListingRepository } from '@/infrastructure/prisma/repositories/PrismaListingRepository'
import { PrismaSearchRepository } from '@/infrastructure/prisma/repositories/PrismaSearchRepository'
import { PrismaAiAnalysisRepository } from '@/infrastructure/prisma/repositories/PrismaAiAnalysisRepository'
import { PrismaListingImageRepository } from '@/infrastructure/prisma/repositories/PrismaListingImageRepository'
import { PrismaNotificationRepository } from '@/infrastructure/prisma/repositories/PrismaNotificationRepository'
import { PrismaListingLabelRepository } from '@/infrastructure/prisma/repositories/PrismaListingLabelRepository'
import { PrismaTaxonomyRepository } from '@/infrastructure/prisma/repositories/PrismaTaxonomyRepository'

import { PlaywrightScraper } from '@/infrastructure/scraping/PlaywrightLbcScraper'
import { LocalStorageService } from '@/infrastructure/storage/LocalStorageService'
import { CloudinaryStorageService } from '@/infrastructure/storage/CloudinaryStorageService'
import { IStorageService } from '@/infrastructure/storage/IStorageService'
import { ImageDownloadService } from '@/infrastructure/storage/ImageDownloadService'
import { OpenAiPriceEstimationService } from '@/infrastructure/ai/OpenAiPriceEstimationService'
import { ResendMailer } from '@/infrastructure/mail/ResendMailer'


import { IPriceEstimationService } from '@/domain/services/IPriceEstimationService'

import { RunListingScrapingUseCase } from '@/application/use-cases/RunListingScrapingUseCase'
import { RunReferenceScrapersUseCase } from '@/application/use-cases/RunReferenceScrapersUseCase'
import { RunAiAnalysisUseCase } from '@/application/use-cases/RunAiAnalysisUseCase'
import { RunNotificationUseCase } from '@/application/use-cases/RunNotificationUseCase'
import { GeminiPriceEstimationService } from '../ai/GeminiPriceEstimationService'

export class Container {
  private static instance: Container

  public readonly prisma: PrismaClient

  public readonly listingRepository: PrismaListingRepository
  public readonly searchRepository: PrismaSearchRepository
  public readonly aiAnalysisRepository: PrismaAiAnalysisRepository
  public readonly listingImageRepository: PrismaListingImageRepository
  public readonly notificationRepository: PrismaNotificationRepository
  public readonly listingLabelRepository: PrismaListingLabelRepository
  public readonly taxonomyRepository: PrismaTaxonomyRepository

  public readonly scraper: PlaywrightScraper
  public readonly storageService: IStorageService
  public readonly imageDownloadService: ImageDownloadService
  public readonly priceEstimationService: IPriceEstimationService
  public readonly mailer: ResendMailer



  public readonly runListingScrapingUseCase: RunListingScrapingUseCase
  public readonly runReferenceScrapersUseCase: RunReferenceScrapersUseCase
  public readonly runAiAnalysisUseCase: RunAiAnalysisUseCase
  public readonly runNotificationUseCase: RunNotificationUseCase

  private constructor() {
    this.prisma = prisma

    this.listingRepository = new PrismaListingRepository(this.prisma)
    this.searchRepository = new PrismaSearchRepository(this.prisma)
    this.aiAnalysisRepository = new PrismaAiAnalysisRepository(this.prisma)
    this.listingImageRepository = new PrismaListingImageRepository(this.prisma)
    this.notificationRepository = new PrismaNotificationRepository(this.prisma)
    this.listingLabelRepository = new PrismaListingLabelRepository(this.prisma)
    this.taxonomyRepository = new PrismaTaxonomyRepository(this.prisma)

    this.scraper = new PlaywrightScraper()
    this.storageService = env.STORAGE_TYPE === 'cloudinary'
      ? new CloudinaryStorageService()
      : new LocalStorageService(env.STORAGE_LOCAL_PATH)
    this.imageDownloadService = new ImageDownloadService(
      this.storageService,
      this.listingImageRepository
    )
    this.priceEstimationService = new OpenAiPriceEstimationService(
      env.OPENAI_API_KEY,
      this.storageService
    )
    // this.priceEstimationService = new GeminiPriceEstimationService(
    //   env.GOOGLE_GEMINI_API_KEY,
    //   this.storageService
    // )
    this.mailer = new ResendMailer(env.RESEND_API_KEY)

    const aiCategorizationService = new (require('@/infrastructure/ai/AiCategorizationService').AiCategorizationService)(env.OPENAI_API_KEY, this.taxonomyRepository)
    const ingestionService = new (require('@/infrastructure/scraping/IngestionService').IngestionService)(this.prisma, aiCategorizationService)

    this.runListingScrapingUseCase = new RunListingScrapingUseCase(
      this.searchRepository,
      this.listingRepository,
      this.listingImageRepository,
      this.scraper
    )

    this.runReferenceScrapersUseCase = new RunReferenceScrapersUseCase(ingestionService, this.prisma)

    this.runAiAnalysisUseCase = new RunAiAnalysisUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.listingImageRepository,
      this.priceEstimationService,
      this.imageDownloadService,
      this.storageService,
      new (require('@/infrastructure/scraping/ReferenceProductService').ReferenceProductService)(this.prisma),
      aiCategorizationService
    )

    this.runNotificationUseCase = new RunNotificationUseCase(
      this.listingRepository,
      this.aiAnalysisRepository,
      this.notificationRepository,
      this.mailer,
      env.NOTIFICATION_EMAIL_TO,
      env.NOTIFICATION_EMAIL_FROM,
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

