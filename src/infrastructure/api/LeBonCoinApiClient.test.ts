import { describe, it } from 'vitest'
import { LeBonCoinApiClient } from './LeBonCoinApiClient'

describe('LeBonCoinApiClient', () => {
  it('should return listings for a search term', async () => {
    const client = new LeBonCoinApiClient()

    // name: 'Maison Jansen',
    // url: 'https://www.leboncoin.fr/recherche?text=Maison+Jansen',
    
    const searchUrl = 'https://www.leboncoin.fr/recherche?text=Maison+Jansen'
    const searchName = 'Maison Jansen'
    
    console.log('\n🔍 Recherche:', searchName)
    console.log('📋 URL:', searchUrl)
    console.log('\n⏳ Appel de l\'API...\n')
    
    const results = await client.search(searchUrl, searchName)
    
    console.log('\n📊 Résultats:')
    console.log('='.repeat(80))
    console.log(`Nombre total d'annonces retournées: ${results.length}`)
    console.log('\nDétails des annonces:')
    
    if (results.length === 0) {
      console.log('Aucune annonce trouvée')
    } else {
      results.forEach((listing, index) => {
        console.log(`\n${index + 1}. ${listing.title}`)
        console.log(`   ID: ${listing.lbcId}`)
        console.log(`   Prix: ${listing.priceCents / 100}€`)
        console.log(`   Localisation: ${listing.city}, ${listing.region}`)
        console.log(`   URL: ${listing.url}`)
        console.log(`   Publié le: ${listing.publishedAt?.toISOString() || 'N/A'}`)
        console.log(`   Images: ${listing.imageUrls.length} image(s)`)
        if (listing.imageUrls.length > 0) {
          listing.imageUrls.slice(0, 3).forEach((url, i) => {
            console.log(`     - ${i + 1}. ${url}`)
          })
          if (listing.imageUrls.length > 3) {
            console.log(`     ... et ${listing.imageUrls.length - 3} autre(s)`)
          }
        }
      })
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify(results, null, 2))
  })
})
