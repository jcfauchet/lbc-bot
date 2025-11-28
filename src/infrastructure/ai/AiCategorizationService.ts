import OpenAI from 'openai';
import { ITaxonomyRepository } from '@/domain/repositories/ITaxonomyRepository';

export interface CategorizationResult {
  category: string;
  period?: string;
  material?: string;
  style?: string;
  designer?: string;
}

export class AiCategorizationService {
  private client: OpenAI;
  private taxonomyRepository: ITaxonomyRepository;

  constructor(apiKey: string, taxonomyRepository: ITaxonomyRepository) {
    this.client = new OpenAI({ apiKey });
    this.taxonomyRepository = taxonomyRepository;
  }

  async categorize(
    title: string,
    description?: string,
    rawAttributes?: any
  ): Promise<CategorizationResult | null> {
    try {
      const [categories, periods, materials, styles] = await Promise.all([
        this.taxonomyRepository.getCategories(),
        this.taxonomyRepository.getPeriods(),
        this.taxonomyRepository.getMaterials(),
        this.taxonomyRepository.getStyles(),
      ]);

      const prompt = this.buildPrompt(title, description, rawAttributes);

      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert in vintage furniture and design. 
Your task is to classify products into a strict taxonomy.
If the product does NOT belong to any of the allowed categories (e.g. it is a watch, jewelry, clothing, car, etc.), return null for the category.

IMPORTANT EXCLUSION RULES:
Exclude "junk" or low-value items. Specifically:
- Exclude mass-market modern furniture brands (IKEA, Conforama, But, Alinéa, Maisons du Monde, etc.) unless they are vintage/collectible specific pieces.
- Exclude items in very poor condition ("épave", "à restaurer", "mauvais état") unless it is a high-value designer piece.
- Exclude generic, low-quality items that are clearly not vintage or design.

If the item is excluded based on these rules, return null for the category.

Allowed Categories: ${categories.join(', ')}
Allowed Periods: ${periods.join(', ')}
Allowed Materials: ${materials.join(', ')}
Allowed Styles: ${styles.join(', ')}

Return a JSON object with:
- category: One of the allowed categories, or null if out of scope or excluded.
- period: One of the allowed periods (optional).
- material: One of the allowed materials (optional, pick the main one).
- style: One of the allowed styles (optional).
- designer: The designer name if identified (optional).
`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const result = JSON.parse(content);
      
      if (!result.category || !categories.includes(result.category)) {
        return null;
      }

      return {
        category: result.category,
        period: periods.includes(result.period) ? result.period : undefined,
        material: materials.includes(result.material) ? result.material : undefined,
        style: styles.includes(result.style) ? result.style : undefined,
        designer: result.designer || undefined,
      };

    } catch (error) {
      console.error('AI Categorization error:', error);
      return null;
    }
  }

  private buildPrompt(title: string, description?: string, rawAttributes?: any): string {
    let prompt = `Product Title: ${title}\n`;
    if (description) prompt += `Description: ${description.substring(0, 500)}\n`; // Limit description length
    if (rawAttributes) {
      prompt += `Raw Attributes: ${JSON.stringify(rawAttributes)}\n`;
    }
    return prompt;
  }
}
