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
    logInfo('CRON:analyze', 'Starting scheduled analysis job')
    
    const result = await container.runAiAnalysisUseCase.execute(10)
    
    logInfo('CRON:analyze', `Analysis completed: ${result.analyzed} analyzed`, result)

    const notificationResult = await container.runNotificationUseCase.execute()
    
    logInfo('CRON:analyze', `Notification completed: ${notificationResult.sent} sent`, notificationResult)

    
    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    })
  }, 'CRON:analyze')
}

