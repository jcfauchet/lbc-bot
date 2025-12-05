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

  protected readonly systemInstruction = `Expert en Arts Décoratifs et Design. Spécialité: signatures, matériaux nobles, designers iconiques (Jansen, Baguès, Willy, Rizzo, Charles, Finn Juhl, Wegner, etc.), détection de copies.

Analyse basée sur: photos fournies, connaissances (styles, périodes, designers, prix marché secondaire).

Mission:
1. Décrire le produit: identifier objet, style, période, matériaux, designer si identifiable
2. Estimer prix marché seconde main basé sur tes connaissances du marché
3. Fourchette large mais plausible
4. Confiance selon clarté photos et certitude

Répondre UNIQUEMENT en JSON selon le schéma fourni.`

  abstract preEstimate(
    images: string[],
    title: string,
    description?: string,
    categories?: string[]
  ): Promise<PreEstimationResult>

  abstract estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts?: any[]
  ): Promise<FinalEstimationResult>

  abstract analyzeForSearch(
    images: string[],
    title: string,
    description?: string
  ): Promise<SearchAnalysisResult>

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

  protected formatReferenceProduct(ref: any, index: number): string {
    const details = [];
    if (ref.designer) details.push(`Designer: ${ref.designer}`);
    if (ref.period) details.push(`Période: ${ref.period}`);
    if (ref.material) details.push(`Matériau: ${ref.material}`);
    if (ref.style) details.push(`Style: ${ref.style}`);
    
    const detailsStr = details.length > 0 ? ` (${details.join(', ')})` : '';
    
    return `PRODUIT DE RÉFÉRENCE #${index + 1} :\n${ref.title}${detailsStr} - ${ref.price} ${ref.currency} [${ref.source}]`;
  }

  protected getAnalysisInstructions(): string {
    return `
Analyse le produit et fournis:
1. Une description détaillée du produit (style, matériaux, qualité, signatures, designer si identifiable)
2. Une estimation de prix marché seconde main basée sur tes connaissances

JSON uniquement:
{
  "estimatedMinPrice": <euros>,
  "estimatedMaxPrice": <euros>,
  "description": "<description détaillée du produit>",
  "confidence": 0.1-1.0
}
    `.trim()
  }

  protected buildPreEstimationPrompt(title: string, description?: string, categories?: string[]): string {
    let categoriesSection = ''
    if (categories && categories.length > 0) {
      const categoriesList = categories.map(c => `- ${c.replace(/_/g, ' ')}`).join('\n')
      categoriesSection = `\nCATÉGORIES QUE NOUS GÉRONS (ces catégories incluent leurs variantes : table d'appoint = table basse, desserte = table basse, console = bibliothèque/enfilade, etc.) :\n${categoriesList}\n`
    }
    
    return `
Pré-estimation rapide pour déterminer si analyse approfondie nécessaire.

Info vendeur:
Titre: ${title}
${description ? `Description: ${description}` : ''}${categoriesSection}

Mission:
1. FILTRAGE: "daube" évidente ou hors catégories → shouldProceed: false (être permissif, en cas de doute continuer)
2. PRÉ-ESTIMATION: fourchette prix marché secondaire (être optimiste, ne pas sous-estimer)
3. TERMES RECHERCHE: générer max 10 termes pour sites spécialisés (AuctionFR, Pamono, 1stdibs, Selency) permettant de trouver des produits similaires, si le produit ressemble à un produit d'un designer connu, ou s'il semble être inspiré d'un designer connu, mais qu'aucune signature n'est visible, formaliser des termes de recherche avec le designer de l'objet afin de faire une comparaison visuelle (ex: "table basse verre rectangulaire maison jansen").

Règles (être PERMISSIF pour ne pas manquer de bonnes affaires):
- isPromising: true si prix estimé > ${env.MIN_MARGIN_IN_EUR}€ OU si objet de qualité/style intéressant même sans designer certain
- shouldProceed: true sauf si "daube" évidente ou hors catégories. En cas de doute, continuer.
- hasDesigner: true si designer identifié (même avec incertitude modérée), false sinon (mais continuer quand même si objet intéressant)
- searchTerms: générer même sans designer certain, utiliser caractéristiques/style/matériaux

JSON uniquement:
{
  "estimatedMinPrice": <euros>,
  "estimatedMaxPrice": <euros>,
  "isPromising": <boolean>,
  "shouldProceed": <boolean>,
  "searchTerms": [{"query": "...", "confidence": 0.5-1.0}],
  "description": "<analyse>",
  "confidence": 0.1-1.0
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

  protected parsePreEstimationResponse(content: string): PreEstimationResult {
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

    // Par défaut, être permissif pour ne pas manquer de bonnes affaires
    const isPromising = parsed.isPromising ?? true
    const hasDesigner = parsed.hasDesigner ?? false
    // shouldProceed par défaut à true si isPromising, sinon on vérifie quand même si le prix estimé est intéressant
    const shouldProceed = parsed.shouldProceed ?? (isPromising || (estimatedMinPrice >= env.MIN_MARGIN_IN_EUR))
    
    // Réduire le seuil minimum de confiance pour les search terms (être plus permissif)
    const minConfidence = Math.min(env.SEARCH_TERM_MIN_CONFIDENCE, 0.5) // Au moins 0.5 au lieu de 0.8
    const searchTerms: SearchTerm[] = (parsed.searchTerms || []).map((term: any) => ({
      query: term.query || '',
      designer: term.designer,
      confidence: Math.min(Math.max(term.confidence || minConfidence, minConfidence), 1.0)
    })).filter((term: SearchTerm) => term.query && term.confidence >= minConfidence)

    return {
      estimatedMinPrice: Money.fromEuros(estimatedMinPrice),
      estimatedMaxPrice: Money.fromEuros(estimatedMaxPrice),
      isPromising,
      hasDesigner,
      shouldProceed,
      searchTerms,
      description: parsed.description || parsed.analysis || "Analyse de l'objet non disponible.",
      confidence: Math.min(Math.max(confidence, 0.1), 1.0),
    }
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

  protected parseFinalEstimationResponse(content: string, referenceProducts?: any[]): FinalEstimationResult {
    const baseResult = this.parseResponse(content)
    
    let bestMatchSource: string | undefined
    let bestMatchUrl: string | undefined
    
    if (referenceProducts && referenceProducts.length > 0) {
      const parsed = this.extractJson(content)
      if (parsed && parsed.bestMatchSource) {
        bestMatchSource = parsed.bestMatchSource
        const bestMatch = referenceProducts.find(p => p.source === bestMatchSource)
        if (bestMatch) {
          bestMatchUrl = bestMatch.url
        }
      }
    }
    
    return {
      ...baseResult,
      bestMatchSource,
      bestMatchUrl,
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
      return this.systemInstruction;
  }
}
