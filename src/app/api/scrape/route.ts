import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { withErrorHandling } from '@/infrastructure/logger/ErrorHandler'

export async function POST() {
  return withErrorHandling(async () => {
    const result = await container.runScrapingUseCase.execute()
    
    return NextResponse.json({
      success: true,
      data: result,
    })
  }, 'API:scrape')
}

