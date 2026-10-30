import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { env } from '@/infrastructure/config/env'
import type { PendingAlert } from '@/domain/repositories/IReferenceRepository'
import { HOUSE_LABELS } from '@/domain/auction-houses'
import { referencesPageUrl } from './references-link'
import type { WeeklyReport } from '@/application/use-cases/RunWeeklyReportUseCase'

/** Scraped and model-written text goes into the HTML as text, never as markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A URL inside a double-quoted href/src attribute: the browser decodes '&amp;' back to '&'. */
function escapeUrl(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export class EmailTemplates {
  /** The comp the estimate leans on, as a link she can open to judge it herself. */
  /** The visual check verdict: a count the reader can trust, and the confirmed links. */
  static compCheckBadge(check: { candidates: Array<{ link: string; confirmed: boolean }>; confirmedCount: number } | undefined): string {
    if (!check) return ''
    const total = check.candidates.length
    if (check.confirmedCount === 0) {
      return `<br><span style="color: #b45309;">⚠️ Aucun comparable confirmé sur ${total} : estimation basée sur des ressemblances.</span>`
    }
    const plural = check.confirmedCount > 1 ? 's' : ''
    const links = check.candidates.filter((c) => c.confirmed).slice(0, 3).map((c) => EmailTemplates.comparableLink(c.link)).join(' · ')
    return `<br><span style="color: #15803d;">✅ ${check.confirmedCount} comparable${plural} confirmé${plural} sur ${total}</span> ${links}`
  }

  static comparableLink(source: string): string {
    try {
      const url = new URL(source)
      return `<a href="${source}" style="color: #0066cc; text-decoration: none;">voir sur ${url.hostname.replace(/^www\./, '')}</a>`
    } catch {
      return source
    }
  }

  /** Always-at-hand link to the references page; empty when the feature is locked. */
  static referencesButton(): string {
    const url = referencesPageUrl(env.APP_URL, env.REFERENCES_KEY)
    if (!url) return ''
    return `
    <a href="${url}"
       style="display: inline-block; background: #ff6b00; color: white; text-decoration: none;
              font-weight: bold; padding: 12px 22px; border-radius: 8px; margin: 6px;">
      📸 Ajouter des références
    </a>`
  }

  static goodDealsDigest(
    listings: Array<{ listing: Listing; analysis: AiAnalysis; imageUrl?: string }>
  ): string {
    const listingRows = listings
      .map((item) => {
        const { listing, analysis, imageUrl } = item
        const imageHtml = imageUrl
          ? `<div style="margin-bottom: 15px;">
              <a href="${listing.url}">
                <img src="${imageUrl}" alt="${listing.title}" style="max-width: 400px; width: 100%; height: auto; border-radius: 8px; border: 1px solid #ddd; display: block;" />
              </a>
            </div>`
          : ''
        return `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 20px;">
              ${imageHtml}
              <h3 style="margin: 0 0 10px 0;">
                <a href="${listing.url}" style="color: #0066cc; text-decoration: none;">
                  ${listing.title}
                </a>
              </h3>
              <p style="margin: 5px 0; color: #666;">
                ${listing.city || ''} ${listing.region ? `- ${listing.region}` : ''}
              </p>
              <div style="margin: 10px 0;">
                <span style="font-size: 24px; font-weight: bold; color: #ff6b00;">
                  ${listing.price.toString()}
                </span>
                <span style="margin-left: 10px; color: #666;">
                  Estimé: ${analysis.estimatedMinPrice.toString()} - ${analysis.estimatedMaxPrice.toString()}
                </span>
              </div>
              <div style="margin-top: 10px;">
                <strong>Marge estimée (min):</strong> ${analysis.estimatedMinPrice.minus(listing.price).toString()}
                ${analysis.bestMatchSource ? `<br><strong>Objet comparable :</strong> ${EmailTemplates.comparableLink(analysis.bestMatchSource)}` : ''}
                ${EmailTemplates.compCheckBadge(analysis.compCheck)}
                ${imageUrl ? `<br><a href="https://lens.google.com/upload?url=${encodeURIComponent(imageUrl)}" style="color: #0066cc; text-decoration: none; display: inline-block; margin-top: 5px;">🔍 Recherche Google Lens</a>` : ''}
              </div>
              <p style="margin: 10px 0; color: #333;">
                ${analysis.description}
              </p>
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; color: #999;">
                Cette sélection était-elle pertinente ?
                <a href="${env.APP_URL}/feedback?id=${listing.id}&vote=good" style="margin-left: 8px; color: #22c55e; text-decoration: none; font-weight: bold;">👍 Oui</a>
                <a href="${env.APP_URL}/feedback?id=${listing.id}&vote=bad" style="margin-left: 8px; color: #ef4444; text-decoration: none; font-weight: bold;">👎 Non</a>
              </div>
            </td>
          </tr>
        `
      })
      .join('')

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bonnes affaires Le Bon Coin</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
              color: white; 
              padding: 30px; 
              border-radius: 10px 10px 0 0; 
              text-align: center;">
    <h1 style="margin: 0; font-size: 28px;">🎯 Bonnes affaires du jour</h1>
    <p style="margin: 10px 0 0 0; font-size: 16px;">
      ${listings.length} opportunité${listings.length > 1 ? 's' : ''} trouvée${listings.length > 1 ? 's' : ''}
    </p>
  </div>
  
  <div style="background: white; padding: 16px 20px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <a href="${env.APP_URL}/feedback/inbox"
       style="display: inline-block; background: #667eea; color: white; text-decoration: none;
              font-weight: bold; padding: 12px 22px; border-radius: 8px;">
      🗳️ Noter toutes les annonces sur une page
    </a>
    ${EmailTemplates.referencesButton()}
    <p style="margin: 8px 0 0 0; font-size: 12px; color: #999;">
      Tout au même endroit, sans revenir à ce mail.
    </p>
  </div>

  <table style="width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    ${listingRows}
  </table>
  
  <div style="background: #f5f5f5; 
              padding: 20px; 
              text-align: center; 
              border-radius: 0 0 10px 10px; 
              color: #666;">
    <p style="margin: 0;">
      Bot de sourcing Le Bon Coin avec IA
    </p>
  </div>
</body>
</html>
    `
  }

  /** One half of the side-by-side photo row of a match email. */
  private static matchPhoto(url: string | null, caption: string): string {
    return url
      ? `<td style="width: 50%; padding: 6px; vertical-align: top; text-align: center;">
           <img src="${escapeUrl(url)}" alt="${escapeHtml(caption)}" style="width: 100%; max-width: 280px; border-radius: 8px; border: 1px solid #ddd;" />
           <div style="font-size: 12px; color: #666; margin-top: 4px;">${escapeHtml(caption)}</div>
         </td>`
      : ''
  }

  private static matchVoteLine(rawListingId: string): string {
    const listingId = escapeUrl(rawListingId)
    return `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; color: #999;">
    C'est bien la même pièce ?
    <a href="${env.APP_URL}/feedback?id=${listingId}&vote=good" style="margin-left: 8px; color: #22c55e; text-decoration: none; font-weight: bold;">👍 Oui</a>
    <a href="${env.APP_URL}/feedback?id=${listingId}&vote=bad" style="margin-left: 8px; color: #ef4444; text-decoration: none; font-weight: bold;">👎 Non</a>
  </div>`
  }

  /** One email per ad for every auction lot confirmed on it, closest lot first (sorted by the caller). */
  static auctionMatch(alerts: PendingAlert[]): { subject: string; html: string } {
    const [best] = alerts
    const house = best.auction ? HOUSE_LABELS[best.auction.house] : ''
    const euros = (cents: number) => `${Math.round(cents / 100)} €`
    const day = (d: Date) =>
      `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    const lots = alerts.map((alert) => {
      const lot = alert.auction
      if (!lot) return ''
      const perUnit = lot.quantity > 1 ? ` (${euros(lot.hammerPerUnitCents)} la pièce, lot de ${lot.quantity})` : ''
      return `
  <div style="margin: 12px 0; padding: 12px; border: 1px solid #eee; border-radius: 8px;">
    <p style="margin: 0; font-weight: bold;">${escapeHtml(lot.artist ? `${lot.artist}, ${lot.title}` : lot.title)}</p>
    <p style="margin: 2px 0;">Adjugé ${euros(lot.hammerCents)} le ${day(lot.soldAt)}${perUnit}</p>
    <p style="margin: 2px 0; color: #666;">${escapeHtml(lot.saleName)}</p>
    <p style="margin: 2px 0;"><a href="${escapeUrl(lot.lotUrl)}" style="color: #0066cc; text-decoration: none;">Voir le lot</a></p>
    ${alert.reason ? `<p style="margin: 6px 0 0 0; color: #333;"><strong>Pourquoi :</strong> ${escapeHtml(alert.reason)}</p>` : ''}
  </div>`
    }).join('')
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 22px; margin: 0 0 16px 0;">🔨 Vu chez ${house}</h1>
  <table style="width: 100%; border-collapse: collapse;"><tr>
    ${EmailTemplates.matchPhoto(best.listingImageUrl, 'Annonce')}
    ${EmailTemplates.matchPhoto(best.referenceImageUrl, `Lot ${house}`)}
  </tr></table>
  <h2 style="font-size: 18px; margin: 16px 0 4px 0;">
    <a href="${escapeUrl(best.listingUrl)}" style="color: #0066cc; text-decoration: none;">${escapeHtml(best.listingTitle)}</a>
  </h2>
  <p style="margin: 0; font-size: 22px; font-weight: bold; color: #ff6b00;">${euros(best.priceCents)}</p>
  ${best.city ? `<p style="margin: 2px 0; color: #666;">${escapeHtml(best.city)}</p>` : ''}
  ${lots}
  <p style="margin: 16px 0;">
    <a href="${escapeUrl(best.listingUrl)}" style="display: inline-block; background: #ff6b00; color: white; text-decoration: none; font-weight: bold; padding: 12px 22px; border-radius: 8px;">Voir l'annonce</a>
  </p>
  <p style="margin: 0 0 16px 0;">${EmailTemplates.referencesButton()}</p>
  ${EmailTemplates.matchVoteLine(best.listingId)}
</body>
</html>`
    const hammer = best.auction ? euros(best.auction.hammerCents) : ''
    return { subject: `🔨 Vu chez ${house} à ${hammer} : ${best.listingTitle}`, html }
  }

  static referenceMatch(alert: PendingAlert): { subject: string; html: string } {
    const price = `${(alert.priceCents / 100).toFixed(0)} €`
    const photo = EmailTemplates.matchPhoto
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 22px; margin: 0 0 6px 0;">🎯 Ça ressemble à ta référence</h1>
  <p style="margin: 0 0 16px 0; color: #666;">${escapeHtml(alert.referenceName)}</p>
  <table style="width: 100%; border-collapse: collapse;"><tr>
    ${photo(alert.listingImageUrl, 'Annonce')}
    ${photo(alert.referenceImageUrl, 'Ta référence')}
  </tr></table>
  <h2 style="font-size: 18px; margin: 16px 0 4px 0;">
    <a href="${escapeUrl(alert.listingUrl)}" style="color: #0066cc; text-decoration: none;">${escapeHtml(alert.listingTitle)}</a>
  </h2>
  <p style="margin: 0; font-size: 22px; font-weight: bold; color: #ff6b00;">${price}</p>
  ${alert.city ? `<p style="margin: 2px 0; color: #666;">${escapeHtml(alert.city)}</p>` : ''}
  ${alert.reason ? `<p style="margin: 10px 0; color: #333;"><strong>Pourquoi :</strong> ${escapeHtml(alert.reason)}</p>` : ''}
  <p style="margin: 16px 0;">
    <a href="${escapeUrl(alert.listingUrl)}" style="display: inline-block; background: #ff6b00; color: white; text-decoration: none; font-weight: bold; padding: 12px 22px; border-radius: 8px;">Voir l'annonce</a>
  </p>
  <p style="margin: 0 0 16px 0;">${EmailTemplates.referencesButton()}</p>
  ${EmailTemplates.matchVoteLine(alert.listingId)}
</body>
</html>`
    return { subject: `🎯 Ressemble à ta référence : ${alert.referenceName}`, html }
  }

  /** Sunday email: last week's emails waiting for a vote, then the funnel numbers. */
  static weeklyReport(report: WeeklyReport): string {
    const pct = (part: number, total: number) => (total ? `${Math.round((100 * part) / total)} %` : '—')
    const usd = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)} $`)
    const hours = (v: number | null) => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')} h`)
    const row = (label: string, value: string) =>
      `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">${value}</td></tr>`

    const unvotedRows = report.unvoted.map((m) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 10px 0;">
          <a href="${m.url}" style="color: #0066cc; text-decoration: none;">${m.title}</a>
          <span style="color: #999;"> · ${Math.round(m.priceCents / 100)} €</span>
        </td>
        <td style="padding: 10px 0; text-align: right; white-space: nowrap;">
          <a href="${env.APP_URL}/feedback?id=${m.listingId}&vote=good" style="color: #22c55e; text-decoration: none; font-weight: bold;">👍 Oui</a>
          <a href="${env.APP_URL}/feedback?id=${m.listingId}&vote=bad" style="margin-left: 8px; color: #ef4444; text-decoration: none; font-weight: bold;">👎 Non</a>
        </td>
      </tr>`).join('')

    const worstHours = report.worstScrapeHours
      .map((h) => `${h.hour}h (${h.blocked}/${h.attempts})`)
      .join(', ')

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Bilan de la semaine</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h1 style="margin: 0 0 4px 0; font-size: 24px;">📊 Bilan de la semaine</h1>
  <p style="margin: 0 0 20px 0; color: #666;">Les 7 derniers jours du bot.</p>

  <h2 style="font-size: 18px; margin: 0 0 8px 0;">🗳️ À noter (${report.unvoted.length})</h2>
  ${report.unvoted.length
    ? `<p style="margin: 0 0 8px 0; color: #666;">Chaque vote apprend au bot ce qui vous plaît.</p>
  <table style="width: 100%; border-collapse: collapse;">${unvotedRows}</table>
  <p style="margin: 12px 0 24px 0;"><a href="${env.APP_URL}/feedback/inbox" style="display: inline-block; background: #667eea; color: white; text-decoration: none; font-weight: bold; padding: 10px 20px; border-radius: 8px;">Tout noter sur une page</a></p>`
    : '<p style="margin: 0 0 24px 0; color: #666;">Tout est noté, merci !</p>'}

  <h2 style="font-size: 18px; margin: 0 0 8px 0;">Chiffres</h2>
  <table style="width: 100%; border-collapse: collapse;">
    ${row('Mails envoyés', String(report.mails))}
    ${row('Mails notés', `${report.voted} (${pct(report.voted, report.mails)})`)}
    ${row('👍 parmi les mails notés', report.precision === null ? '—' : `${report.good} (${pct(report.good, report.voted)})`)}
    ${row('Délai médian publication → mail', hours(report.medianDelayHours))}
    ${row('Estimations par l\'agent', String(report.appraisals))}
    ${row('… sans aucun comparable', `${report.zeroCompAppraisals} (${pct(report.zeroCompAppraisals, report.appraisals)})`)}
    ${row('Coût de l\'agent', usd(report.appraisalCostUsd))}
    ${row('Coût de l\'agent par mail', usd(report.costPerMailUsd))}
    ${row('Recherches Leboncoin bloquées', `${report.scrapeBlocked}/${report.scrapeAttempts} (${pct(report.scrapeBlocked, report.scrapeAttempts)})`)}
    ${worstHours ? row('Heures les plus bloquées', worstHours) : ''}
  </table>
</body>
</html>`
  }
}
