import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { withErrorHandling } from '@/infrastructure/logger/ErrorHandler'
import { logInfo } from '@/infrastructure/logger/logger'

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withErrorHandling(async () => {
    logInfo('CRON:learn-feedback', 'Starting feedback learning job')

    const result = await container.runFeedbackLearningUseCase.execute()

    logInfo(
      'CRON:learn-feedback',
      result.skipped
        ? `Skipped (${result.reason})`
        : `Generated ${result.rulesGenerated} rules from ${result.sourceFeedbackCount} feedbacks`,
      result,
    )

    return NextResponse.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    })
  }, 'CRON:learn-feedback')
}
