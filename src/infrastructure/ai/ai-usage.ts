/**
 * What each AI call costs, by funnel stage. Adapters report their token counts
 * here; the container plugs in a sink that adds them to the day's row in
 * `ai_usage`, which the weekly report turns into a cost per email.
 * The appraisal agent keeps its own record in `appraisal_runs`.
 */
export type AiStage =
  | 'triage'
  | 'ranking'
  | 'comp_check'
  | 'reference_match'
  | 'image_embedding'
  | 'text_embedding'
  | 'feedback_learning'

export interface AiUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Images embedded, for models billed per image. */
  images?: number
}

export interface AiUsageEvent {
  stage: AiStage
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

interface Price {
  /** USD per million tokens. */
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  /** USD per image, for image embeddings. */
  perImage?: number
}

/**
 * List prices read on 11 Nov 2026 (platform.claude.com, ai.google.dev/gemini-api/docs/pricing).
 * Gemini 3.6 Flash doubles on 1 Jan 2027. An unknown model costs 0 and is still counted.
 */
export const AI_PRICING: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-embedding-2-preview': { input: 0.2, output: 0, perImage: 0.00012 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
}

export function aiCostUsd(model: string, usage: AiUsage): number {
  const price = AI_PRICING[model]
  if (!price) return 0
  const tokens =
    (usage.inputTokens ?? 0) * price.input +
    (usage.outputTokens ?? 0) * price.output +
    (usage.cacheReadTokens ?? 0) * (price.cacheRead ?? price.input) +
    (usage.cacheWriteTokens ?? 0) * (price.cacheWrite ?? price.input)
  return tokens / 1e6 + (usage.images ?? 0) * (price.perImage ?? 0)
}

type Sink = (event: AiUsageEvent) => void

let sink: Sink | null = null

/** Null (the default) drops the events: tests and eval scripts record nothing. */
export function setAiUsageSink(next: Sink | null): void {
  sink = next
}

/** Never throws: a failed record must not fail the call it describes. */
export function recordAiUsage(stage: AiStage, model: string, usage: AiUsage): void {
  if (!sink) return
  try {
    sink({
      stage,
      model,
      inputTokens: (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
      outputTokens: usage.outputTokens ?? 0,
      costUsd: aiCostUsd(model, usage),
    })
  } catch (error) {
    console.error('AI usage record failed:', error)
  }
}

/** Token counts of an Anthropic response, in the shape `recordAiUsage` takes. */
export function claudeUsage(usage: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
} | undefined): AiUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  }
}

/** Token counts of a Gemini response; thinking tokens are billed as output. */
export function geminiUsage(metadata: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
} | undefined): AiUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
  }
}
