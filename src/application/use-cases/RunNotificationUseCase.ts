import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { INotificationRepository } from '@/domain/repositories/INotificationRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'
import { Notification, NotificationChannel } from '@/domain/entities/Notification'
import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'

export class RunNotificationUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private notificationRepository: INotificationRepository,
    private imageRepository: IListingImageRepository,
    private mailer: IMailer,
    private recipientEmail: string,
    private fromEmail: string,
    private minMargin: number = 60
  ) {}

  async execute(): Promise<{ sent: number; errors: number }> {
    const goodAnalyses = await this.aiAnalysisRepository.findByMinMargin(
      this.minMargin
    )

    if (goodAnalyses.length === 0) {
      console.log('No good deals found')
      return { sent: 0, errors: 0 }
    }

    const listingsWithAnalysis: Array<{
      listing: Listing
      analysis: AiAnalysis
      imageUrl?: string
    }> = []

    for (const analysis of goodAnalyses) {
      const listing = await this.listingRepository.findById(analysis.listingId)
      if (!listing) continue

      const alreadyNotified = await this.notificationRepository.findByListingId(
        listing.id
      )

      if (alreadyNotified.some((n) => n.status === 'sent')) {
        continue
      }

      const images = await this.imageRepository.findByListingId(listing.id)
      const firstImage = images[0]
      const imageUrl = firstImage?.urlRemote

      listingsWithAnalysis.push({ listing, analysis, imageUrl })
    }

    if (listingsWithAnalysis.length === 0) {
      console.log('All good deals already notified')
      return { sent: 0, errors: 0 }
    }

    listingsWithAnalysis.sort(
      (a, b) =>
        b.analysis.margin.getCents() -
        a.analysis.margin.getCents()
    )

    let sent = 0
    let errors = 0

    try {
      const html = EmailTemplates.goodDealsDigest(listingsWithAnalysis)

      await this.mailer.send({
        to: this.recipientEmail,
        from: this.fromEmail,
        subject: `🎯 ${listingsWithAnalysis.length} bonne${listingsWithAnalysis.length > 1 ? 's' : ''} affaire${listingsWithAnalysis.length > 1 ? 's' : ''} trouvée${listingsWithAnalysis.length > 1 ? 's' : ''}`,
        html,
      })

      for (const item of listingsWithAnalysis) {
        const notification = Notification.create({
          listingId: item.listing.id,
          channel: NotificationChannel.EMAIL,
        })

        notification.markAsSent()
        await this.notificationRepository.save(notification)

        item.listing.markAsNotified()
        await this.listingRepository.update(item.listing)
      }

      sent = listingsWithAnalysis.length
      console.log(`Email sent with ${sent} good deals`)
    } catch (error) {
      console.error('Failed to send notification:', error)
      errors++

      for (const item of listingsWithAnalysis) {
        const notification = Notification.create({
          listingId: item.listing.id,
          channel: NotificationChannel.EMAIL,
        })

        notification.markAsFailed(
          error instanceof Error ? error.message : 'Unknown error'
        )
        await this.notificationRepository.save(notification)
      }
    }

    return { sent, errors }
  }
}

