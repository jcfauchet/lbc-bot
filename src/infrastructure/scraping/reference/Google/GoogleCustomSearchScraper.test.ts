import { describe, it } from 'vitest'
import { GoogleCustomSearchScraper } from './GoogleCustomSearchScraper'

describe('GoogleCustomSearchScraper', () => {
  it('should scrape Google Custom Search API for shopping products from an image URL', async () => {
    const scraper = new GoogleCustomSearchScraper()
    
    const imageUrl = 'https://img.leboncoin.fr/api/v1/lbcpb1/images/2e/d9/a3/2ed9a322e34dc4c7593b5b46f114a9a4828b6bd1.jpg?rule=ad-large'
    
    console.log('\n🔍 Recherche par image:', imageUrl)
    console.log('📋 API: Google Custom Search (Shopping)')
    console.log('\n⏳ Scraping en cours...\n')
    
    const results = await scraper.scrape(imageUrl)

    console.log(results);
  }, 30000)
})

