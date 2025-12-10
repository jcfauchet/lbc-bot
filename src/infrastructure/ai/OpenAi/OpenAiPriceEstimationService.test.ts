import { describe, it } from 'vitest'
import { OpenAiPriceEstimationService } from './OpenAiPriceEstimationService'

describe('OpenAiPriceEstimationService', () => {
  

  it('should perform final price estimation with reference products', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log('\n⚠️  OPENAI_API_KEY not set, skipping test')
      return
    }

    const service = new OpenAiPriceEstimationService(process.env.OPENAI_API_KEY)
    
    const images = [
      'https://img.leboncoin.fr/api/v1/lbcpb1/images/3f/7a/20/3f7a20bf728cde60fc96380a9d2080cbe1000760.jpg?rule=ad-large',
      'https://img.leboncoin.fr/api/v1/lbcpb1/images/e5/7a/9d/e57a9d3ac5833134e978227934e943d844537935.jpg?rule=ad-large',
    ]
    
    const title = 'Table basse style Willy Rizzo'
  
    
    console.log('\n🤖 Estimation Finale IA')
    console.log('='.repeat(80))
    console.log(`Titre: ${title}`)
    console.log(`Images: ${images.length}`)
    console.log(`Provider: ${service.providerName}`)
    console.log('\n⏳ Analyse en cours...\n')
    
    const result = await service.estimatePrice(images, title, undefined)
    
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
  }, 300000)
})

