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
    // const imageUrl = 'https://img.leboncoin.fr/api/v1/lbcpb1/images/9b/aa/fb/9baafbd6db6dd1518fc72731d44967a84699bfb7.jpg?rule=ad-large'
    const imageUrl = 'https://images.selency.com/843c7e45-98d2-4fbd-82e2-d98a622992dc?bg_colour=f5f5f5&width=1762&height=1144&func=bound'
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
    const preEstimation = await container.priceEstimationService.preEstimate(
      [imageUrl],
      title,
      description,
      categories
    )
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    
    console.log('\n📊 RÉSULTATS DE PRÉ-ESTIMATION:')
    console.log('='.repeat(80))
    console.log(`Durée: ${duration}s`)
    console.log(`Prix min estimé: ${preEstimation.estimatedMinPrice.getEuros()}€`)
    console.log(`Prix max estimé: ${preEstimation.estimatedMaxPrice.getEuros()}€`)
    console.log(`Prometteur: ${preEstimation.isPromising ? '✅ Oui' : '❌ Non'}`)
    console.log(`Designer identifié: ${preEstimation.hasDesigner ? '✅ Oui' : '❌ Non'}`)
    console.log(`Doit continuer: ${preEstimation.shouldProceed ? '✅ Oui' : '❌ Non'}`)
    console.log(`Confiance: ${((preEstimation.confidence || 0) * 100).toFixed(1)}%`)
    
    console.log(`\n📝 Description:`)
    console.log(preEstimation.description)
    
    if (preEstimation.searchTerms.length > 0) {
      console.log(`\n🔍 Termes de recherche générés (${preEstimation.searchTerms.length}):`)
      preEstimation.searchTerms.forEach((term, index) => {
        console.log(`\n${index + 1}. "${term.query}"`)
        if (term.designer) {
          console.log(`   Designer: ${term.designer}`)
        }
        console.log(`   Confiance: ${(term.confidence * 100).toFixed(1)}%`)
      })
    } else {
      console.log('\n⚠️  Aucun terme de recherche généré')
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify({
      estimatedMinPrice: preEstimation.estimatedMinPrice.getEuros(),
      estimatedMaxPrice: preEstimation.estimatedMaxPrice.getEuros(),
      isPromising: preEstimation.isPromising,
      hasDesigner: preEstimation.hasDesigner,
      shouldProceed: preEstimation.shouldProceed,
      confidence: preEstimation.confidence,
      searchTerms: preEstimation.searchTerms,
      description: preEstimation.description,
    }, null, 2))
    
    // Assertions
    expect(preEstimation).toBeDefined()
    expect(preEstimation.estimatedMinPrice).toBeDefined()
    expect(preEstimation.estimatedMaxPrice).toBeDefined()
    expect(typeof preEstimation.isPromising).toBe('boolean')
    expect(typeof preEstimation.hasDesigner).toBe('boolean')
    expect(typeof preEstimation.shouldProceed).toBe('boolean')
  })
})

