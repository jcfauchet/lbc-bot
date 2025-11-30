import { describe, it } from 'vitest'
import { container } from '@/infrastructure/di/container'

describe('RunAiAnalysisUseCase', () => {
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
    
    await container.cleanup()
  })
})

