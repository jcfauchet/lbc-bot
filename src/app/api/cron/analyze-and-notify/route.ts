import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'
import { logError, logInfo } from '@/infrastructure/logger/logger'

// 800s is the Vercel Pro/Fluid ceiling; the funnel (prefilter→triage→comp→notify)
// was hitting the old 300s cap and skipping the final notify stage. If the plan
// does not allow 800, Vercel clamps this down at deploy time.
export const maxDuration = 800

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
