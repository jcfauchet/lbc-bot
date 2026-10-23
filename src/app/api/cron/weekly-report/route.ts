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
    const report = await container.runWeeklyReportUseCase.execute()
    const { unvoted, ...numbers } = report
    logInfo('CRON:weekly-report', `Weekly report sent: ${unvoted.length} unvoted`, numbers)

    return NextResponse.json({
      success: true,
      data: { ...numbers, unvoted: unvoted.length },
      timestamp: new Date().toISOString(),
    })
  }, 'CRON:weekly-report')
}
