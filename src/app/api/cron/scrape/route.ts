import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { withErrorHandling } from '@/infrastructure/logger/ErrorHandler'
import { logInfo } from '@/infrastructure/logger/logger'

export const maxDuration = 800

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withErrorHandling(async () => {
    logInfo('CRON:scrape', 'Starting scheduled scraping job')
    
    const result = await container.runListingScrapingUseCase.execute()
    
    logInfo('CRON:scrape', `Scraping completed: ${result.newListings} new listings`, result)
    
    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    })
  }, 'CRON:scrape')
}

