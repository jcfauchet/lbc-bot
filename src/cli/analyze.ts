#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('💎 Stage C — Lens comp analysis (budgeted)...')
  try {
    const res = await container.runCompAnalysisUseCase.execute()
    console.log(`   processed: ${res.processed} | analyzed: ${res.analyzed} | ignored: ${res.ignored}`)
  } catch (error) {
    console.error('❌ Analysis failed:', error)
    process.exit(1)
  } finally {
    await container.cleanup()
  }
}

main()

