import { describe, it } from 'vitest'
import { FirstDibsScraper } from './FirstDibsScraper'

describe('FirstDibsScraper', () => {
  it('should scrape 1stdibs.com for a search query', async () => {
    const scraper = new FirstDibsScraper()
    
    const query = 'maison jansen'
    
    console.log('\n🔍 Recherche:', query)
    console.log('📋 Site: 1stdibs')
    console.log('\n⏳ Scraping en cours...\n')
    
    const results = await scraper.scrape(query)
    
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
  })
})

