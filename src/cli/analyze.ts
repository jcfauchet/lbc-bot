#!/usr/bin/env node

import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🤖 Starting AI analysis...')

  try {
    const result = await container.runAiAnalysisUseCase.execute(10)
    
    console.log('\n✅ Analysis completed!')
    console.log(`   Analyzed: ${result.analyzed}`)
    console.log(`   Errors: ${result.errors}`)
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    await container.cleanup()
  }
}

main()

