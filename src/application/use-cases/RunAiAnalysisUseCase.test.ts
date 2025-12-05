import { describe, it, expect, afterAll } from 'vitest'
import { container } from '@/infrastructure/di/container'

describe('RunAiAnalysisUseCase', () => {
  afterAll(async () => {
    await container.cleanup()
  })

  it('should run analysis flow on listings without analysis', async () => {
    console.log('\n🔄 Flow d\'Analyse Complet')
    console.log('='.repeat(80))
    console.log('\n⏳ Récupération des listings sans analyse...\n')
    
    const batchSize = parseInt(process.argv[2] || '1', 10)
    console.log(`Taille du batch: ${batchSize}`)
    
    const result = await container.runAiAnalysisUseCase.execute(batchSize)
    
    console.log('\n📊 Résultats:')
    console.log('='.repeat(80))
    console.log(`Listings analysés: ${result.analyzed}`)
    console.log(`Erreurs: ${result.errors}`)
    
    if (result.analyzed > 0) {
      console.log('\n✅ Analyse(s) réussie(s)')
    }
    
    if (result.errors > 0) {
      console.log('\n⚠️  Certaines analyses ont échoué')
    }
    
    if (result.analyzed === 0 && result.errors === 0) {
      console.log('\nℹ️  Aucun listing à analyser')
    }
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify(result, null, 2))
    
    expect(result).toBeDefined()
  })

  it.only('should estimate price from image URL, title and description', async () => {
    const imageUrl = 'https://img.leboncoin.fr/api/v1/lbcpb1/images/9b/aa/fb/9baafbd6db6dd1518fc72731d44967a84699bfb7.jpg?rule=ad-large'
    // const imageUrl = 'https://images.selency.com/843c7e45-98d2-4fbd-82e2-d98a622992dc?bg_colour=f5f5f5&width=1762&height=1144&func=bound'
    const title = 'Table basse vintage'
    const description = 'Table bass 1970 vintage'

    console.log('\n🤖 TEST D\'ESTIMATION - Données Manuelles')
    console.log('='.repeat(80))
    console.log(`\nImage URL: ${imageUrl}`)
    console.log(`Titre: ${title}`)
    console.log(`Description: ${description}`)
    console.log(`Provider AI: ${container.priceEstimationService.providerName}`)

    const categories = await container.taxonomyRepository.getCategories()
    console.log(`\n📋 Catégories disponibles: ${categories.length}`)
    if (categories.length > 0) {
      console.log(`   ${categories.join(', ')}`)
    }

    console.log('\n⏳ Pré-estimation en cours...\n')
    
    const startTime = Date.now()
    
    // Pré-estimation
    const estimate = await container.priceEstimationService.estimatePrice(
      [imageUrl],
      title,
      description,
    )
    
    console.log(`\n📊 Résultats:`)
    console.log('='.repeat(80))
    console.log(`Prix estimé: ${estimate.estimatedMinPrice.getEuros()}€ - ${estimate.estimatedMaxPrice.getEuros()}€`)
    console.log(`Confiance: ${((estimate.confidence || 0) * 100).toFixed(1)}%`)
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify(estimate, null, 2))
    
  })
})

