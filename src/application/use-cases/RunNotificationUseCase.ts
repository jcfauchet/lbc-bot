import { IListingRepository } from '@/domain/repositories/IListingRepository'
import { IAiAnalysisRepository } from '@/domain/repositories/IAiAnalysisRepository'
import { INotificationRepository } from '@/domain/repositories/INotificationRepository'
import { IListingImageRepository } from '@/domain/repositories/IListingImageRepository'
import { IMailer } from '@/infrastructure/mail/IMailer'
import { EmailTemplates } from '@/infrastructure/mail/EmailTemplates'
import { Notification, NotificationChannel } from '@/domain/entities/Notification'
import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import {
  computeDealScore,
  isEstimateTrustworthy,
  DEFAULT_MAX_RANGE_RATIO,
} from '@/domain/services/DealScoring'

export class RunNotificationUseCase {
  constructor(
    private listingRepository: IListingRepository,
    private aiAnalysisRepository: IAiAnalysisRepository,
    private notificationRepository: INotificationRepository,
    private imageRepository: IListingImageRepository,
    private mailer: IMailer,
    private recipientEmails: string[],
    private fromEmail: string,
    private minMargin: number = 60,
    // Below this, the comps disagreed too much (e.g. one luxury outlier) for the
    // estimate to be trustworthy. Such deals are surfaced in the inbox but never
    // emailed, to avoid the "estimation trop large / trop élevée" feedback.
    private minConfidence: number = 0.8,
    // The email decision is gated on a CONSERVATIVE margin: the low end of the
    // estimate band (estMin) minus the asking price — i.e. the margin that holds
    // even in the worst realistic resale. The displayed `marginCents` stays
    // median-based (informative), but a high median driven by a couple of
    // optimistic comps no longer earns an email on its own. 0 disables the gate.
    //
    // KEEP THIS AT 0. Measured over the 240 human judgements: the conservative
    // margin is *higher* on bad finds (468 EUR mean) than on good ones (271 EUR),
    // so raising the floor preferentially keeps the bad ones. Thresholds from 0 to
    // 75 EUR change nothing at all; at 150 EUR precision collapses to 12.9%, below
    // the 22.5% base rate. It looks like a safety improvement and is the opposite.
    private minConservativeMarginCents: number = 0,
    // An estimate band wider than this max/min ratio is noise, not an estimate.
    // Backtest over 240 human judgements: good finds average a 1.71x band, bad
    // finds 4.39x. See src/domain/services/DealScoring.ts.
    private maxRangeRatio: number = DEFAULT_MAX_RANGE_RATIO
  ) {}

  async execute(): Promise<{ sent: number; errors: number }> {
    const allAnalyses = await this.aiAnalysisRepository.findByMinMargin(
      this.minMargin
    )
    const goodAnalyses = allAnalyses.filter(
      (a) => a.confidence === undefined || a.confidence >= this.minConfidence
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

      // Trust gate. Two conditions, both grounded in the backtest:
      //  - the estimate band must be tight enough to mean something;
      //  - the deal must still clear the floor at the low end of that band.
      // Together they suppress the phantom margins produced by a lone optimistic
      // comp — the "d'où sors-tu ces prix" class of false positive.
      const estimate = {
        priceCents: listing.price.getCents(),
        estMinCents: analysis.estimatedMinPrice.getCents(),
        estMaxCents: analysis.estimatedMaxPrice.getCents(),
        bestMatchSource: analysis.bestMatchSource,
      }
      if (
        !isEstimateTrustworthy(estimate, {
          maxRangeRatio: this.maxRangeRatio,
          minConservativeMarginCents: this.minConservativeMarginCents,
        })
      ) {
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

    // Ranking is NOT by estimated margin. Backtested over the 240 human
    // judgements in base, that ordering scored AUC 0.298 where 0.5 is a coin
    // flip — it is inverted, because the biggest margins come from the biggest
    // hallucinations. We rank on evidence quality instead: band tightness, comp
    // provenance, and plausibility of the estimate against the asking price.
    listingsWithAnalysis.sort(
      (a, b) =>
        computeDealScore({
          priceCents: b.listing.price.getCents(),
          estMinCents: b.analysis.estimatedMinPrice.getCents(),
          estMaxCents: b.analysis.estimatedMaxPrice.getCents(),
          bestMatchSource: b.analysis.bestMatchSource,
        }) -
        computeDealScore({
          priceCents: a.listing.price.getCents(),
          estMinCents: a.analysis.estimatedMinPrice.getCents(),
          estMaxCents: a.analysis.estimatedMaxPrice.getCents(),
          bestMatchSource: a.analysis.bestMatchSource,
        })
    )

    let sent = 0
    let errors = 0

    try {
      const html = EmailTemplates.goodDealsDigest(listingsWithAnalysis)

      await this.mailer.send({
        to: this.recipientEmails,
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

