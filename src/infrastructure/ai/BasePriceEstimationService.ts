import {
  IPriceEstimationService,
  PriceEstimationResult,
} from '@/domain/services/IPriceEstimationService'
import { Money } from '@/domain/value-objects/Money'
import fs from 'fs/promises'
import path from 'path'

export abstract class BasePriceEstimationService
  implements IPriceEstimationService
{
  abstract readonly providerName: string

  protected readonly systemInstruction = `Tu es un Commissaire-Priseur Senior et Expert en Arts Décoratifs et Design (XXe siècle et contemporain).
        Ta spécialité est d'identifier les signatures, les matériaux nobles, les icônes du design (Maison Jansen, Maison Baguès, Maison Charles, Finn Juhl, Hans J. Wegner, etc.) et de repérer les copies.

        Ton analyse doit reposer sur :
        - ce que tu vois sur les photos fournies,
        - ta connaissance interne (styles, périodes, designers, fourchettes de prix typiques du marché secondaire).
        - **Tu DOIS utiliser l'outil de recherche Google Search si tu as un doute sur l'identification d'un produit que tu penses être de valeur (signature, designer iconique, modèle spécifique, etc.) pour vérifier son authenticité, son nom, ou sa fourchette de prix actuelle.**

        Ta mission :
        1. Identifier visuellement le type d’objet, son style, sa période probable, ses matériaux.
        2. Donner une estimation réaliste de prix pour le marché de la seconde main (particuliers, résultats des ventes maisons de ventes, plateformes comme Selency, 1stdibs, Pamono, etc.).
        3. Donner une fourchette large mais plausible.
        4. Donner un niveau de confiance basé sur la clarté des photos et ton niveau de certitude.

        Tu dois toujours répondre en utilisant strictement le format JSON spécifié dans le schéma de sortie.
      `

  abstract estimatePrice(
    images: string[],
    title: string,
    description?: string
  ): Promise<PriceEstimationResult>

  protected buildPrompt(
    title: string, 
    description?: string,
    referenceProducts: Array<{
      title: string;
      price: number;
      currency: string;
      source: string;
      designer?: string;
      period?: string;
      material?: string;
      style?: string;
      url: string;
      imageUrls?: string[];
    }> = []
  ): string {
    let referenceSection = '';
    if (referenceProducts.length > 0) {
      const productLines = referenceProducts.map((ref, index) => {
        const details = [];
        if (ref.designer) details.push(`Designer: ${ref.designer}`);
        if (ref.period) details.push(`Période: ${ref.period}`);
        if (ref.material) details.push(`Matériau: ${ref.material}`);
        if (ref.style) details.push(`Style: ${ref.style}`);
        
        const detailsStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        const imageInfo = ref.imageUrls && ref.imageUrls.length > 0 
          ? ` [${ref.imageUrls.length} image(s) fournie(s) pour comparaison]` 
          : '';
        return `${index + 1}. ${ref.title}${detailsStr} - ${ref.price} ${ref.currency} [${ref.source}]${imageInfo}`;
      }).join('\n');

      referenceSection = `\n\nPRODUITS DE RÉFÉRENCE SIMILAIRES :\nVoici des produits similaires trouvés sur des sites spécialisés (Pamono, 1stdibs, etc.) qui peuvent vous aider à estimer le prix. Les images de ces produits de référence sont également fournies pour comparaison visuelle, si le produit de référence ne correspond pas, ignore-le :\n${productLines}\n`;
    }

    return `
Analyse l'image et les informations ci-dessous en suivant scrupuleusement cette méthodologie d'expert :

CONTEXTE UTILISATEUR :
Titre : ${title}
${description ? `Description fournie : ${description}` : ''}${referenceSection}

Sois critique sur le titre et la description fournis. Si tu penses qu'elle est fausse, indique le.

MÉTHODOLOGIE D'ANALYSE :
1. ANALYSE VISUELLE : Identifie le style, les matériaux, et la qualité de fabrication. Cherche les signatures.
2. IDENTIFICATION : Est-ce un designer connu ? Une attribution ? Ou un style générique ? **N'oublie pas d'utiliser l'outil de recherche pour les vérifications importantes.**
3. BENCHMARK : Base ton prix sur la valeur de marché actuelle (Market Value) pour une vente entre particuliers ou sur une plateforme spécialisée.

INSTRUCTIONS DE SORTIE (JSON UNIQUEMENT) :
Tu dois fournir ta réponse UNIQUEMENT au format JSON valide, sans texte avant ou après, sans markdown, sans blocs de code.
Le JSON doit respecter exactement ce schéma :
{
  "estimatedMinPrice": <nombre en euros>,
  "estimatedMaxPrice": <nombre en euros>,
  "description": "<texte d'analyse détaillé>",
  "confidence": <nombre entre 0.1 et 1.0>
}

Exemple de réponse valide :
{"estimatedMinPrice": 500, "estimatedMaxPrice": 1200, "description": "Chaise vintage en bois...", "confidence": 0.75}
    `.trim()
  }

  protected parseResponse(content: string): PriceEstimationResult {
    if (!content || content.trim().length === 0) {
      console.error('Empty response content')
      throw new Error('Invalid response format: empty content')
    }

    let jsonString: string | null = null
    let parsed: any = null

    const extractionStrategies = [
      () => {
        const markdownJsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
        return markdownJsonMatch ? markdownJsonMatch[1] : null
      },
      () => {
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        return jsonMatch ? jsonMatch[0] : null
      },
      () => {
        const trimmed = content.trim()
        return trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : null
      },
    ]

    for (const strategy of extractionStrategies) {
      try {
        jsonString = strategy()
        if (jsonString) {
          parsed = JSON.parse(jsonString)
          if (parsed && typeof parsed === 'object') {
            break
          }
        }
      } catch (e) {
        continue
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      console.error('Failed to extract valid JSON from response')
      console.error('Response content (first 500 chars):', content.substring(0, 500))
      throw new Error(`Invalid response format: could not parse JSON. Content preview: ${content.substring(0, 200)}`)
    }

    let confidence = 0.5
    if (typeof parsed.confidence === 'number') {
      confidence = parsed.confidence
    } else if (typeof parsed.confidence === 'string') {
      const match = parsed.confidence.match(/(\d+(?:\.\d+)?)/)
      if (match) {
        confidence = parseFloat(match[1])
        if (confidence > 1) confidence = confidence / 100
      }
    }

    const estimatedMinPrice = parsed.estimatedMinPrice ?? parsed.minPrice ?? parsed.estimated_min_price ?? 0
    const estimatedMaxPrice = parsed.estimatedMaxPrice ?? parsed.maxPrice ?? parsed.estimated_max_price ?? 0

    if (typeof estimatedMinPrice !== 'number' || typeof estimatedMaxPrice !== 'number') {
      console.error('Invalid price values in response:', { estimatedMinPrice, estimatedMaxPrice })
      console.error('Full parsed response:', parsed)
      throw new Error(`Invalid response format: price values must be numbers. Got min: ${estimatedMinPrice}, max: ${estimatedMaxPrice}`)
    }

    return {
      estimatedMinPrice: Money.fromEuros(estimatedMinPrice),
      estimatedMaxPrice: Money.fromEuros(estimatedMaxPrice),
      description: parsed.description || parsed.analysis || "Analyse de l'objet non disponible.",
      confidence: Math.min(Math.max(confidence, 0.1), 1.0),
    }
  }

  protected async readImageFile(
    image: string
  ): Promise<{ base64: string; mimeType: string } | null> {
    const imagePath = path.join(process.cwd(), 'public', image)
    try {
      const buffer = await fs.readFile(imagePath)
      const base64 = buffer.toString('base64')
      const ext = path.extname(image).slice(1)
      const mimeType =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      return { base64, mimeType }
    } catch (error) {
      console.error(`Failed to read local image ${image}:`, error)
      return null
    }
  }
  
  protected getSystemInstruction(): string {
      return this.systemInstruction;
  }
}
