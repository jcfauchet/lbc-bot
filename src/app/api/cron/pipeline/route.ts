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
    logInfo('CRON:pipeline', 'Starting pipeline: scrape -> analyze -> notify')
    
    const results = {
      scrape: null as any,
      analyze: null as any,
      notify: null as any,
    }
    
    try {
      logInfo('CRON:pipeline', 'Step 1/3: Starting scraping')
      results.scrape = await container.runListingScrapingUseCase.execute()
      logInfo('CRON:pipeline', `Step 1/3: Scraping completed - ${results.scrape.newListings} new listings`, results.scrape)
      
      logInfo('CRON:pipeline', 'Step 2/3: Starting analysis')
      results.analyze = await container.runAiAnalysisUseCase.execute(10)
      logInfo('CRON:pipeline', `Step 2/3: Analysis completed - ${results.analyze.analyzed} analyzed`, results.analyze)
      
      logInfo('CRON:pipeline', 'Step 3/3: Starting notifications')
      results.notify = await container.runNotificationUseCase.execute()
      logInfo('CRON:pipeline', `Step 3/3: Notifications completed - ${results.notify.sent} sent`, results.notify)
      
      logInfo('CRON:pipeline', 'Pipeline completed successfully', results)
      
      return NextResponse.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      logInfo('CRON:pipeline', 'Pipeline failed', { error, results })
      throw error
    }
  }, 'CRON:pipeline')
}

