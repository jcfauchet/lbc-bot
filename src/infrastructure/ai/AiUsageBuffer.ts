import type { AiUsageEvent } from './ai-usage'

export interface AiUsageTotals {
  stage: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Adds up usage events in memory and writes one row per stage and model, so
 * thousands of calls a day cost a handful of database writes. It writes on its
 * own every `flushEveryMs`; callers flush at the end of a job for the remainder.
 */
export class AiUsageBuffer {
  private totals = new Map<string, AiUsageTotals>()
  private lastFlush: number

  constructor(
    private readonly write: (rows: AiUsageTotals[]) => Promise<void>,
    private readonly flushEveryMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    this.lastFlush = now()
  }

  add(event: AiUsageEvent): void {
    const key = `${event.stage}\u0000${event.model}`
    const row = this.totals.get(key) ?? { stage: event.stage, model: event.model, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    row.calls++
    row.inputTokens += event.inputTokens
    row.outputTokens += event.outputTokens
    row.costUsd += event.costUsd
    this.totals.set(key, row)
    if (this.now() - this.lastFlush >= this.flushEveryMs) void this.flush()
  }

  /** Never rejects; rows that could not be written are counted again at the next flush. */
  async flush(): Promise<void> {
    this.lastFlush = this.now()
    if (this.totals.size === 0) return
    const rows = [...this.totals.values()]
    this.totals = new Map()
    try {
      await this.write(rows)
    } catch (error) {
      console.error('AI usage flush failed:', error)
      for (const row of rows) {
        const key = `${row.stage}\u0000${row.model}`
        const pending = this.totals.get(key)
        if (!pending) {
          this.totals.set(key, row)
          continue
        }
        pending.calls += row.calls
        pending.inputTokens += row.inputTokens
        pending.outputTokens += row.outputTokens
        pending.costUsd += row.costUsd
      }
    }
  }
}
