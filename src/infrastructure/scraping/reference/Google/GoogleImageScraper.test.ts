import { describe, it } from 'vitest'
import { GoogleImageScraper } from './GoogleImageScraper'

describe('GoogleImageScraper', () => {
  it('should scrape Google Image/Lens for a product image', async () => {
    const scraper = new GoogleImageScraper()
    
    // URL d'image de test - une chaise design vintage
    // URL d'image de test - une chaise Eames (connue pour avoir des résultats)
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Eames_Lounge_Chair_and_Ottoman.jpg/800px-Eames_Lounge_Chair_and_Ottoman.jpg'
    
    console.log('\n🔍 Recherche par image:', imageUrl)
    console.log('📋 Site: Google Lens (Shopping)')
    console.log('\n⏳ Scraping en cours...\n')
    
    const results = await scraper.scrape(imageUrl)
    
    console.log('\n📊 Résultats:')
    console.log('='.repeat(80))
    console.log(`Nombre total de produits trouvés: ${results.length}`)
    console.log('\nDétails des produits:')
    
    if (results.length === 0) {
      console.log('Aucun produit trouvé')
    } else {
      results.forEach((product, index) => {
        console.log(`\n${index + 1}. ${product.title}`)
        console.log(`   Prix: ${product.price} ${product.currency}`)
        console.log(`   Source: ${product.source}`)
        console.log(`   URL: ${product.url}`)
        if (product.designer) {
          console.log(`   Designer: ${product.designer}`)
        }
        if (product.period) {
          console.log(`   Période: ${product.period}`)
        }
        if (product.material) {
          console.log(`   Matériau: ${product.material}`)
        }
        if (product.style) {
          console.log(`   Style: ${product.style}`)
        }
        if (product.imageUrls && product.imageUrls.length > 0) {
          console.log(`   Images: ${product.imageUrls.length} image(s)`)
          product.imageUrls.slice(0, 2).forEach((url, i) => {
            console.log(`     - ${i + 1}. ${url}`)
          })
        }
      })
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify(results, null, 2))
  }, 120000) // Timeout de 120 secondes pour Google Lens
})
