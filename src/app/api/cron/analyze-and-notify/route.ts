import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { withErrorHandling } from '@/infrastructure/logger/ErrorHandler'
import { logInfo } from '@/infrastructure/logger/logger'

export const maxDuration = 300 // Should be 800

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withErrorHandling(async () => {
    logInfo('CRON:analyze', 'Starting scheduled analysis job')
    
    await container.runPreFilterUseCase.execute()
    await container.runTriageUseCase.execute()
    const result = await container.runCompAnalysisUseCase.execute()

    const notificationResult = await container.runNotificationUseCase.execute()

    logInfo('CRON:analyze', `Funnel completed: ${result.analyzed} analyzed, ${result.processed} processed, ${result.ignored} ignored`, result)
    logInfo('CRON:analyze', `Notification completed: ${notificationResult.sent} sent`, notificationResult)

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    })
  }, 'CRON:analyze')
}

