#!/usr/bin/env node
import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('🔎 Stage B — Gemini triage...')
  const res = await container.runTriageUseCase.execute()
  console.log(`   triaged: ${res.triaged} | ignored: ${res.ignored}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
