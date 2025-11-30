import { describe, it } from 'vitest'
import { OpenAiPriceEstimationService } from './OpenAiPriceEstimationService'

describe('OpenAiPriceEstimationService', () => {
  it('should perform pre-estimation with filtering and search terms generation', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('\n⚠️  OPENAI_API_KEY not set, skipping test')
      return
    }

    const service = new OpenAiPriceEstimationService(process.env.OPENAI_API_KEY)
    
    const images = [
      'https://example.com/image1.jpg',
      'https://example.com/image2.jpg',
    ]
    
    const title = 'Table basse laiton verre rectangulaire Maison Jansen'
    
    console.log('\n🤖 Pré-Estimation IA')
    console.log('='.repeat(80))
    console.log(`Titre: ${title}`)
    console.log(`Images: ${images.length}`)
    console.log(`Provider: ${service.providerName}`)
    console.log('\n⏳ Analyse en cours...\n')
    
    const result = await service.preEstimate(images, title)
    
    console.log('\n📊 Résultats de Pré-Estimation:')
    console.log('='.repeat(80))
    console.log(`Prix estimé: ${result.estimatedMinPrice.getEuros()}€ - ${result.estimatedMaxPrice.getEuros()}€`)
    console.log(`Prometteur: ${result.isPromising ? '✅ Oui' : '❌ Non'}`)
    console.log(`Designer identifié: ${result.hasDesigner ? '✅ Oui' : '❌ Non'}`)
    console.log(`Doit continuer: ${result.shouldProceed ? '✅ Oui' : '❌ Non'}`)
    console.log(`Confiance: ${((result.confidence || 0) * 100).toFixed(1)}%`)
    
    console.log(`\n📝 Description:`)
    console.log(result.description)
    
    if (result.searchTerms.length > 0) {
      console.log(`\n🔍 Termes de recherche générés (${result.searchTerms.length}):`)
      result.searchTerms.forEach((term, index) => {
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
      estimatedMinPrice: result.estimatedMinPrice.getEuros(),
      estimatedMaxPrice: result.estimatedMaxPrice.getEuros(),
      isPromising: result.isPromising,
      hasDesigner: result.hasDesigner,
      shouldProceed: result.shouldProceed,
      confidence: result.confidence,
      searchTerms: result.searchTerms,
      description: result.description,
    }, null, 2))
  })

  it('should perform final price estimation with reference products', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('\n⚠️  OPENAI_API_KEY not set, skipping test')
      return
    }

    const service = new OpenAiPriceEstimationService(process.env.OPENAI_API_KEY)
    
    const images = [
      'https://example.com/image1.jpg',
      'https://example.com/image2.jpg',
    ]
    
    const title = 'Table basse laiton verre rectangulaire Maison Jansen'
    
    const referenceProducts = [
      {
        title: 'Table basse Maison Jansen verre laiton',
        price: 2500,
        currency: 'EUR',
        source: 'Pamono',
        designer: 'Maison Jansen',
        url: 'https://pamono.fr/example',
        imageUrls: ['https://example.com/ref1.jpg'],
      },
      {
        title: 'Jansen coffee table glass brass',
        price: 2800,
        currency: 'EUR',
        source: '1stdibs',
        designer: 'Maison Jansen',
        url: 'https://1stdibs.com/example',
        imageUrls: ['https://example.com/ref2.jpg'],
      },
    ]
    
    console.log('\n🤖 Estimation Finale IA')
    console.log('='.repeat(80))
    console.log(`Titre: ${title}`)
    console.log(`Images: ${images.length}`)
    console.log(`Produits de référence: ${referenceProducts.length}`)
    console.log(`Provider: ${service.providerName}`)
    console.log('\n⏳ Analyse en cours...\n')
    
    const result = await service.estimatePrice(images, title, undefined, referenceProducts)
    
    console.log('\n📊 Résultats d\'Estimation:')
    console.log('='.repeat(80))
    console.log(`Prix estimé: ${result.estimatedMinPrice.getEuros()}€ - ${result.estimatedMaxPrice.getEuros()}€`)
    console.log(`Confiance: ${((result.confidence || 0) * 100).toFixed(1)}%`)
    if (result.bestMatchSource) {
      console.log(`Meilleur match - Source: ${result.bestMatchSource}`)
    }
    if (result.bestMatchUrl) {
      console.log(`Meilleur match - URL: ${result.bestMatchUrl}`)
    }
    
    console.log(`\n📝 Description:`)
    console.log(result.description)
    
    console.log('\n' + '='.repeat(80))
    console.log('\n📦 Résultat complet (JSON):')
    console.log(JSON.stringify({
      estimatedMinPrice: result.estimatedMinPrice.getEuros(),
      estimatedMaxPrice: result.estimatedMaxPrice.getEuros(),
      confidence: result.confidence,
      bestMatchSource: result.bestMatchSource,
      bestMatchUrl: result.bestMatchUrl,
      description: result.description,
    }, null, 2))
  })
})

