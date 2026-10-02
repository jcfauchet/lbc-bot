import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'
import { env } from '@/infrastructure/config/env'
import type { PendingAlert } from '@/domain/repositories/IReferenceRepository'
import { referencesPageUrl } from './references-link'

export class EmailTemplates {
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
                <strong>Estimation:</strong> ${analysis.estimatedMinPrice.toString()} - ${analysis.estimatedMaxPrice.toString()}
                <br>
                <strong>Marge estimée (min):</strong> ${analysis.estimatedMinPrice.minus(listing.price).toString()}
                ${analysis.bestMatchSource ? `<br><strong>Revente recommandée:</strong> ${analysis.bestMatchSource}` : ''}
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

  static referenceMatch(alert: PendingAlert): { subject: string; html: string } {
    const price = `${(alert.priceCents / 100).toFixed(0)} €`
    const photo = (url: string | null, caption: string) => url
      ? `<td style="width: 50%; padding: 6px; vertical-align: top; text-align: center;">
           <img src="${url}" alt="${caption}" style="width: 100%; max-width: 280px; border-radius: 8px; border: 1px solid #ddd;" />
           <div style="font-size: 12px; color: #666; margin-top: 4px;">${caption}</div>
         </td>`
      : ''
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h1 style="font-size: 22px; margin: 0 0 6px 0;">🎯 Ça ressemble à ta référence</h1>
  <p style="margin: 0 0 16px 0; color: #666;">${alert.referenceName}</p>
  <table style="width: 100%; border-collapse: collapse;"><tr>
    ${photo(alert.listingImageUrl, 'Annonce')}
    ${photo(alert.referenceImageUrl, 'Ta référence')}
  </tr></table>
  <h2 style="font-size: 18px; margin: 16px 0 4px 0;">
    <a href="${alert.listingUrl}" style="color: #0066cc; text-decoration: none;">${alert.listingTitle}</a>
  </h2>
  <p style="margin: 0; font-size: 22px; font-weight: bold; color: #ff6b00;">${price}</p>
  ${alert.city ? `<p style="margin: 2px 0; color: #666;">${alert.city}</p>` : ''}
  ${alert.reason ? `<p style="margin: 10px 0; color: #333;"><strong>Pourquoi :</strong> ${alert.reason}</p>` : ''}
  <p style="margin: 16px 0;">
    <a href="${alert.listingUrl}" style="display: inline-block; background: #ff6b00; color: white; text-decoration: none; font-weight: bold; padding: 12px 22px; border-radius: 8px;">Voir l'annonce</a>
  </p>
  <p style="margin: 0 0 16px 0;">${EmailTemplates.referencesButton()}</p>
  <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee; font-size: 13px; color: #999;">
    C'est bien la même pièce ?
    <a href="${env.APP_URL}/feedback?id=${alert.listingId}&vote=good" style="margin-left: 8px; color: #22c55e; text-decoration: none; font-weight: bold;">👍 Oui</a>
    <a href="${env.APP_URL}/feedback?id=${alert.listingId}&vote=bad" style="margin-left: 8px; color: #ef4444; text-decoration: none; font-weight: bold;">👎 Non</a>
  </div>
</body>
</html>`
    return { subject: `🎯 Ressemble à ta référence : ${alert.referenceName}`, html }
  }
}
