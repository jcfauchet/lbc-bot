import type Anthropic from '@anthropic-ai/sdk'
import { fetchImage } from '../fetch-image'

/**
 * Low-volume vision judgements (comp check, ranking, reference match, feedback
 * distillation) run on Opus: a few dozen calls/day, which keeps the prepaid Claude
 * budget busy without exceeding it. Triage, the volume driver, stays on Haiku.
 */
export const CLAUDE_JUDGE_MODEL = 'claude-opus-5-5'

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export async function imageBlock(url: string): Promise<Anthropic.ImageBlockParam> {
  const image = await fetchImage(url)
  return { type: 'image', source: { type: 'base64', media_type: image.mimeType as ImageMediaType, data: image.data } }
}

/**
 * The reply's text. A refusal throws instead of returning '' so the caller's
 * fallback provider answers, rather than an empty reply parsing as "no match".
 */
export function responseText(response: Anthropic.Message, task: string): string {
  if (response.stop_reason === 'refusal') throw new Error(`Claude refused ${task}`)
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}
