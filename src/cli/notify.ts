#!/usr/bin/env node

import { container } from '@/infrastructure/di/container'

async function main() {
  console.log('📧 Starting notification...')

  try {
    const result = await container.runNotificationUseCase.execute()
    
    console.log('\n✅ Notification completed!')
    console.log(`   Sent: ${result.sent}`)
    console.log(`   Errors: ${result.errors}`)
  } catch (error) {
    console.error('❌ Notification failed:', error)
    process.exit(1)
  } finally {
    await container.cleanup()
  }
}

main()

