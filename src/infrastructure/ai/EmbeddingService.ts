import OpenAI from 'openai'
import { recordAiUsage } from './ai-usage'

export class EmbeddingService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    recordAiUsage('text_embedding', 'text-embedding-3-small', { inputTokens: response.usage?.prompt_tokens ?? 0 })
    return response.data[0].embedding
  }
}
