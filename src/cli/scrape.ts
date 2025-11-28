#!/usr/bin/env node

import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🔍 Starting scraping...')

  try {
    const result = await container.runListingScrapingUseCase.execute()
    
    console.log('\n✅ Scraping completed!')
    console.log(`   Searches processed: ${result.totalSearches}`)
    console.log(`   New listings: ${result.newListings}`)
    console.log(`   Updated listings: ${result.updatedListings}`)
  } catch (error) {
    console.error('❌ Scraping failed:', error)
    process.exit(1)
  } finally {
    await container.cleanup()
  }
}

main()

