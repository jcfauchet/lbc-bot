import {
  IPriceEstimationService,
  PriceEstimationResult,
  SearchAnalysisResult,
  PreEstimationResult,
  FinalEstimationResult,
  SearchTerm,
} from '@/domain/services/IPriceEstimationService'
import { Money } from '@/domain/value-objects/Money'
import fs from 'fs/promises'
import { env } from '../config/env'
import path from 'path'

export abstract class BasePriceEstimationService
  implements IPriceEstimationService
{

  abstract readonly providerName: string

  abstract estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts?: any[]
  ): Promise<FinalEstimationResult>

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
Analyse expert:

Info vendeur (indicatif):
Titre: ${title}
${description ? `Description: ${description}` : ''}${referenceSection}

Critique sur titre/description (peuvent être inexactes). Designer: baser sur connaissances et références.

${this.getAnalysisInstructions()}
    `.trim()
  }

  protected buildUserContext(title: string, description?: string): string {
    return `
Analyse expert:

Info vendeur:
Titre: ${title}
${description ? `Description: ${description}` : ''}

Critique sur titre/description (peuvent être inexactes). Designer: baser sur connaissances et références, pas sur info vendeur.
    `.trim()
  }

  protected getAnalysisInstructions(): string {
    return `
Analyse le produit et fournis:
1. Une description détaillée du produit (style, matériaux, qualité, signatures, designer possible)
2. Une estimation de prix de revente RÉALISTE sur le marché secondaire français
3. Un score de potentiel de flip (flipScore) de 1 à 10
4. La meilleure plateforme de revente (bestResalePlatform) : Selency, Pamono, 1stDibs, Vinted, eBay, Catawiki, Drouot, etc.

RÈGLES D'ESTIMATION DE PRIX (très important) :
- Estime le prix auquel l'objet SE VENDRAIT réellement en 30 jours, pas le prix maximum théorique
- Base-toi sur les transactions récentes, pas sur les prix affichés sur Pamono/1stDibs (souvent 3x surestimés)
- L'état est inconnu : suppose un état moyen avec des défauts normaux d'usure
- Sois CONSERVATEUR et PESSIMISTE : mieux vaut sous-estimer que sur-estimer
- Sur Selency/Vinted les prix sont 30-50% en dessous de Pamono — c'est là que tu dois te baser
- Si tu n'es pas sûr du designer, estime comme un objet anonyme de style similaire

RÈGLES DE SCORING (flipScore) :
- 8-10 : objet clairement identifiable, forte demande, vendeur manifestement ignorant de la valeur
- 5-7 : objet intéressant mais incertitude sur le designer ou l'authenticité
- 1-4 : objet courant, difficile à revendre, ou vendeur qui connaît la valeur

DISQUALIFICATIONS (→ flipScore = 1, confidence = 0.1) :
- L'objet semble être une copie, reproduction ou imitation
- Le titre/description mentionne déjà un designer, une marque de design ou une plateforme spécialisée

JSON uniquement:
{
  "estimatedMinPrice": <euros>,
  "estimatedMaxPrice": <euros>,
  "description": "<description détaillée : objet, style, période, matériaux, designer identifié ou probable, état apparent>",
  "confidence": 0.1-1.0,
  "flipScore": 1-10,
  "bestResalePlatform": "<plateforme>"
}
    `.trim()
  }

  protected buildSearchPrompt(title: string, description?: string): string {
    return `
Identifier objet et générer recherche précise.

Info:
Titre: ${title}
${description ? `Description: ${description}` : ''}

Mission:
1. Identifier objet, style, période, designer/fabricant
2. Générer UNE SEULE query précise pour site d'enchères (ex: "table basse verre rectangulaire maison jansen" pas "table basse jansen")
3. Inclure matériaux, forme, designer si connu
4. Designer: baser sur connaissances, pas sur info vendeur

JSON uniquement:
{
  "searchQuery": "<query précise>",
  "designer": "<Designer>" ou null
}
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

    const result: PriceEstimationResult = {
      estimatedMinPrice: Money.fromEuros(estimatedMinPrice),
      estimatedMaxPrice: Money.fromEuros(estimatedMaxPrice),
      description: parsed.description || parsed.analysis || "Analyse de l'objet non disponible.",
      confidence: Math.min(Math.max(confidence, 0.1), 1.0),
    }
    
    return result
  }

  protected parseFinalEstimationResponse(content: string): FinalEstimationResult {
    const baseResult = this.parseResponse(content)
    const parsed = this.extractJson(content)

    const flipScore: number | undefined = typeof parsed?.flipScore === 'number' ? parsed.flipScore : undefined
    const bestResalePlatform: string | undefined = typeof parsed?.bestResalePlatform === 'string' ? parsed.bestResalePlatform : undefined

    return {
      ...baseResult,
      flipScore,
      bestResalePlatform,
      bestMatchSource: bestResalePlatform,
    }
  }

  protected parseSearchResponse(content: string): SearchAnalysisResult {
    const parsed = this.extractJson(content)
    
    if (!parsed || typeof parsed.searchQuery !== 'string') {
      throw new Error('Invalid response format: missing or invalid searchQuery')
    }

    return {
      searchQuery: parsed.searchQuery,
      designer: parsed.designer || undefined
    }
  }

  protected extractJson(content: string): any {
    if (!content || content.trim().length === 0) return null

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
        const jsonString = strategy()
        if (jsonString) {
          const parsed = JSON.parse(jsonString)
          if (parsed && typeof parsed === 'object') {
            return parsed
          }
        }
      } catch (e) {
        continue
      }
    }
    return null
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
      return `Expert en Arts Décoratifs, Design Vintage et Brocante de valeur. Tu aides à identifier des objets sous-estimés sur des sites de particuliers (LeBonCoin) pour les revendre avec une forte marge sur des plateformes spécialisées.

Spécialités:
- Mobilier design 1950-1990 : Knoll, Cassina, Ligne Roset, Artifort, Herman Miller, Vitra, Kartell
- Luminaires : Maison Jansen, Baguès, Arteluce, Ingo Maurer, Stilnovo, Fontana Arte
- Designers iconiques : Willy Rizzo, Finn Juhl, Hans Wegner, Arne Jacobsen, Pierre Paulin, Charlotte Perriand, Le Corbusier, Eames, Saarinen, Bertoia, Breuer, Mies van der Rohe
- Céramiques et arts de la table : Vallauris, Biot, Capron, Ruelland, Picault, Salins, Longwy
- Bronzes, marqueterie, bois noble, laiton, travertin, marbre

Tu détectes : signatures gravées/moulées, étiquettes de fabricant, matériaux d'époque, construction artisanale vs industrielle, reproductions modernes.

Répondre UNIQUEMENT en JSON selon le schéma fourni.`
  }
}
