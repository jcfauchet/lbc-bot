import { Listing } from '@/domain/entities/Listing'
import { AiAnalysis } from '@/domain/entities/AiAnalysis'

export class EmailTemplates {
  static goodDealsDigest(
    listings: Array<{ listing: Listing; analysis: AiAnalysis }>
  ): string {
    const listingRows = listings
      .map((item) => {
        const { listing, analysis } = item
        return `
          <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 20px;">
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
              </div>
              <p style="margin: 10px 0; color: #333;">
                ${analysis.description}
              </p>
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
}
