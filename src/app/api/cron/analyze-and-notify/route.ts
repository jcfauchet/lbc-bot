import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { logError, logInfo } from '@/infrastructure/logger/logger'

export const maxDuration = 300 // Should be 800

/**
 * Runs one funnel stage in isolation: a stage that throws is logged but does not
 * abort the rest of the funnel. Before this, a single failing stage (e.g. triage
 * choking on one bad image) 500'd the whole route and starved every downstream
 * stage, jamming the pipeline.
 */
async function runStage<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    logError(`CRON:analyze:${name}`, err)
    return { error: err instanceof Error ? err.message : 'unknown error' }
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  logInfo('CRON:analyze', 'Starting scheduled analysis job')

  const prefilter = await runStage('prefilter', () => container.runPreFilterUseCase.execute())
  const triage = await runStage('triage', () => container.runTriageUseCase.execute())
  const analysis = await runStage('comp', () => container.runCompAnalysisUseCase.execute())
  const notification = await runStage('notify', () => container.runNotificationUseCase.execute())

  const stages = { prefilter, triage, analysis, notification }
  const failed = Object.entries(stages)
    .filter(([, r]) => r && typeof r === 'object' && 'error' in r)
    .map(([k]) => k)

  logInfo('CRON:analyze', `Funnel done. Failed stages: ${failed.length ? failed.join(', ') : 'none'}`, stages)

  return NextResponse.json({
    success: failed.length === 0,
    failedStages: failed,
    data: stages,
    timestamp: new Date().toISOString(),
  })
}
