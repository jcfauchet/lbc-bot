
import { PlaywrightScraper } from '../infrastructure/scraping/PlaywrightLbcScraper'

async function main() {
  const scraper = new PlaywrightScraper()
  const url = 'https://www.leboncoin.fr/recherche?category=19&text=table+laiton&kst=r&from=rs'
  
  console.log(`Scraping URL: ${url}`)
  
  try {
    const listings = await scraper.scrape(url)
    console.log(`Found ${listings.length} listings`)
    
    if (listings.length > 0) {
      console.log('First listing:', JSON.stringify(listings[0], null, 2))
      
      const listingsWithImages = listings.filter(l => l.imageUrls.length > 0)
      console.log(`Listings with images: ${listingsWithImages.length}/${listings.length}`)
      
      if (listingsWithImages.length === 0) {
        console.log('❌ No images found!')
      } else {
        console.log('✅ Images found!')
      }
    } else {
      console.log('❌ No listings found!')
    }
  } catch (error) {
    console.error('Error scraping:', error)
  } finally {
    await scraper.close()
  }
}

main()
