import Anthropic from '@anthropic-ai/sdk'
import type { IReferenceMatchVerifier, ReferenceMatchInput, ReferenceVerdict } from '@/domain/services/IReferenceMatchVerifier'
import { buildReferenceMatchPrompt, parseReferenceVerdict } from '../reference-match-prompt'
import { CLAUDE_JUDGE_MODEL, imageBlock, responseText } from './claude-message'

export class ClaudeReferenceMatchVerifier implements IReferenceMatchVerifier {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model = CLAUDE_JUDGE_MODEL) {
    this.client = new Anthropic({ apiKey })
  }

  async verify(input: ReferenceMatchInput): Promise<ReferenceVerdict> {
    const listingImages = await Promise.all(input.listingImageUrls.map(imageBlock))
    const referenceImages = await Promise.all(input.referenceImageUrls.map(imageBlock))
    const prompt = buildReferenceMatchPrompt({
      listingTitle: input.listingTitle,
      referenceName: input.referenceName,
      referenceNote: input.referenceNote,
      listingImageCount: listingImages.length,
      referenceImageCount: referenceImages.length,
    })
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...listingImages, ...referenceImages] }],
    })
    return parseReferenceVerdict(responseText(response, 'the reference match'))
  }
}
