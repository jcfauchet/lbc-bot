#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🧹 Stage A — pre-filter...')
  const res = await container.runPreFilterUseCase.execute()
  console.log(`   prefiltered: ${res.prefiltered} | ignored: ${res.ignored}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
