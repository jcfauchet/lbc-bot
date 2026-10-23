import Anthropic from '@anthropic-ai/sdk'
import type { Appraisal, AppraisalCost, AppraisalInput, IAppraisalAgent } from '@/domain/services/IAppraisalAgent'
import { fetchProductPage, type ProductPage } from '@/infrastructure/comps/product-page-photos'
import {
  APPRAISAL_LISTING_PHOTOS, APPRAISAL_SYSTEM_PROMPT, acceptedComps, appraisalLeads, buildAppraisalBrief, describeInspectedPage,
  describeLead, normalizeUrl, submissionSchema,
} from '../appraisal-agent-prompt'
import { imageBlock } from './claude-message'

export interface AppraisalBudget {
  /** API round trips, each one model turn. The last one is spent on the submission. */
  maxTurns: number
  /** Web searches over the whole appraisal. */
  maxSearches: number
  /** Product pages opened over the whole appraisal. */
  maxInspections: number
}

export const DEFAULT_APPRAISAL_BUDGET: AppraisalBudget = { maxTurns: 14, maxSearches: 6, maxInspections: 8 }

/** Dealer photos shown per inspected page: enough for detail shots, bounded in vision tokens. */
const PHOTOS_PER_PAGE = 3
/** Searches allowed within one API request; the whole-appraisal cap is enforced across turns. */
const SEARCHES_PER_TURN = 3

/** USD per million tokens, list prices. */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
}
const WEB_SEARCH_USD = 0.01

const INSPECT_TOOL: Anthropic.Tool = {
  name: 'inspect_page',
  description: 'Open a product page: returns the price the page publishes and up to three dealer photos. Use it on every candidate comparable before submitting it.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full https URL of the product page.' } },
    required: ['url'],
    additionalProperties: false,
  },
}

const SUBMIT_TOOL: Anthropic.Tool = {
  name: 'submit_appraisal',
  description: 'Submit your conclusion. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      identification: { type: 'string', description: 'What the piece is: maker or designer, model, period; or your best description if unidentified.' },
      same_model_urls: { type: 'array', items: { type: 'string' }, description: 'Inspected pages showing the SAME model as the ad. Empty when none does.' },
      notes: { type: 'string', description: 'Two or three sentences: the hypotheses you tried, and why the comparables match or why none was found.' },
    },
    required: ['identification', 'same_model_urls', 'notes'],
    additionalProperties: false,
  },
}

const SEARCH_TOOL: Anthropic.WebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: SEARCHES_PER_TURN,
  // The ad itself, and other private ads, are not comparables.
  blocked_domains: ['leboncoin.fr'],
}

function emptyCost(): AppraisalCost {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, pagesInspected: 0, turns: 0, usd: 0 }
}

/**
 * Appraisal as an agent loop rather than one call: the number of searches and
 * pages it takes depends on what the first hypothesis turns up, which a fixed
 * pipeline (one Lens search, take what comes) cannot adapt to. Bounded by
 * `budget`; every comparable it submits is re-checked against the pages it
 * really opened (see acceptedComps).
 */
export class ClaudeAppraisalAgent implements IAppraisalAgent {
  readonly providerName: string
  private readonly client: Anthropic

  constructor(
    apiKey: string,
    private readonly model = 'claude-sonnet-5-5',
    private readonly effort: 'low' | 'medium' | 'high' = 'medium',
    private readonly budget: AppraisalBudget = DEFAULT_APPRAISAL_BUDGET,
  ) {
    this.client = new Anthropic({ apiKey })
    this.providerName = `claude-appraisal-agent:${model}`
  }

  async appraise(input: AppraisalInput): Promise<Appraisal> {
    const loaded = await Promise.allSettled(input.imageUrls.slice(0, APPRAISAL_LISTING_PHOTOS).map(imageBlock))
    const adPhotos = loaded.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (adPhotos.length === 0) throw new Error(`No ad photo could be downloaded for "${input.title}"`)

    const messages: Anthropic.MessageParam[] = [{
      role: 'user',
      content: [{ type: 'text', text: buildAppraisalBrief(input) }, ...adPhotos, ...await this.leadBlocks(input)],
    }]
    const inspected = new Map<string, ProductPage | null>()
    const cost = emptyCost()

    for (let turn = 0; turn < this.budget.maxTurns; turn++) {
      // Dropping the search tool rewrites the cached prefix once; capping max_uses
      // per turn instead would rewrite it on every turn.
      const tools = cost.webSearches < this.budget.maxSearches ? [SEARCH_TOOL, INSPECT_TOOL, SUBMIT_TOOL] : [INSPECT_TOOL, SUBMIT_TOOL]
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system: APPRAISAL_SYSTEM_PROMPT,
        tools,
        messages,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: this.effort },
      })
      this.addUsage(cost, response.usage)
      for (const block of response.content) {
        if (block.type === 'web_search_tool_result' && !Array.isArray(block.content)) {
          console.warn(`Appraisal web search failed for "${input.title}": ${block.content.error_code}`)
        }
      }
      if (response.stop_reason === 'refusal') throw new Error(`Claude refused to appraise "${input.title}"`)
      messages.push({ role: 'assistant', content: response.content })
      // A long server-side search loop pauses; re-sending resumes it.
      if (response.stop_reason === 'pause_turn') continue

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const submit = toolUses.find((t) => t.name === 'submit_appraisal')
      if (submit) {
        const parsed = submissionSchema.safeParse(submit.input)
        if (!parsed.success) throw new Error(`Malformed appraisal submission for "${input.title}"`)
        return {
          identification: parsed.data.identification,
          comps: acceptedComps(parsed.data.same_model_urls, inspected),
          notes: parsed.data.notes,
          cost,
        }
      }
      if (toolUses.length === 0) break
      if (response.stop_reason === 'max_tokens') throw new Error(`Appraisal turn cut off at max_tokens for "${input.title}"`)

      const results = await Promise.all(toolUses.map((t) => this.runTool(t, inspected, cost)))
      const content: Anthropic.ContentBlockParam[] = [...results]
      if (turn === this.budget.maxTurns - 2) content.push({ type: 'text', text: 'Budget exhausted: call submit_appraisal now with what you have.' })
      messages.push({ role: 'user', content })
    }
    return { identification: '', comps: [], notes: 'The agent stopped without submitting an appraisal.', cost }
  }

  /** Each lead's line, then its thumbnail when it loads: the agent picks what to inspect by eye. */
  private async leadBlocks(input: AppraisalInput): Promise<Anthropic.ContentBlockParam[]> {
    const leads = appraisalLeads(input.leads)
    if (leads.length === 0) return []
    const thumbnails = await Promise.allSettled(leads.map((l) => (l.imageUrl ? imageBlock(l.imageUrl) : Promise.reject(new Error('no thumbnail')))))
    return [
      { type: 'text', text: `Reverse-image search (Google Lens) on the cover photo returned these ${leads.length} leads:` },
      ...leads.flatMap((lead, i): Anthropic.ContentBlockParam[] => {
        const thumbnail = thumbnails[i]
        return [{ type: 'text', text: describeLead(lead, i + 1) }, ...(thumbnail.status === 'fulfilled' ? [thumbnail.value] : [])]
      }),
    ]
  }

  private async runTool(tool: Anthropic.ToolUseBlock, inspected: Map<string, ProductPage | null>, cost: AppraisalCost): Promise<Anthropic.ToolResultBlockParam> {
    const fail = (message: string): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: message })
    if (tool.name !== 'inspect_page') return fail(`Unknown tool ${tool.name}.`)
    const url = (tool.input as { url?: unknown }).url
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) return fail('inspect_page needs a full https URL.')
    if (/leboncoin\.fr/i.test(url)) return fail('Leboncoin ads are not comparables.')
    if (cost.pagesInspected >= this.budget.maxInspections) return fail('Inspection budget exhausted: submit with what you have.')

    cost.pagesInspected++
    const page = await fetchProductPage(url, PHOTOS_PER_PAGE)
    const photos = page
      ? (await Promise.allSettled(page.photos.map(async (src) => ({ src, block: await imageBlock(src) }))))
          .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      : []
    // Only the photos the agent was actually shown can back a "same model" verdict.
    inspected.set(normalizeUrl(url), page && { ...page, photos: photos.map((p) => p.src) })
    return {
      type: 'tool_result',
      tool_use_id: tool.id,
      content: [{ type: 'text', text: describeInspectedPage(page, photos.length) }, ...photos.map((p) => p.block)],
    }
  }

  private addUsage(cost: AppraisalCost, usage: Anthropic.Usage): void {
    const price = PRICING[this.model] ?? PRICING['claude-opus-5-5']
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const cacheWrite = usage.cache_creation_input_tokens ?? 0
    const searches = usage.server_tool_use?.web_search_requests ?? 0
    cost.turns++
    cost.inputTokens += usage.input_tokens
    cost.outputTokens += usage.output_tokens
    cost.cacheReadTokens += cacheRead
    cost.cacheWriteTokens += cacheWrite
    cost.webSearches += searches
    cost.usd += (usage.input_tokens * price.input + usage.output_tokens * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) / 1e6
      + searches * WEB_SEARCH_USD
  }
}
