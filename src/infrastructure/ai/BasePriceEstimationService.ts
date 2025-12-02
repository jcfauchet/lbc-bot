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
Analyse l'image et les informations ci-dessous en suivant scrupuleusement cette méthodologie d'expert :

CONTEXTE UTILISATEUR (à titre indicatif, ne doit pas servir à influencer l'estimation) :
Titre : ${title}
${description ? `Description fournie : ${description}` : ''}${referenceSection}

Sois critique sur le titre et la description fournis. Si tu penses qu'elle est fausse, tiens en compte dans l'estimation. Celle-ci étant fournie par le vendeur, elles peuvent être inexactes.

Pour déterminer le designer, base toi sur tes connaissances et les produits de référence plus que sur le nom et la description fournis qui peuvent être fausses ou inexactes (fournis par le vendeur).

${this.getAnalysisInstructions()}
    `.trim()
  }

  protected buildUserContext(title: string, description?: string): string {
    return `
Analyse l'image et les informations ci-dessous en suivant scrupuleusement cette méthodologie d'expert :

CONTEXTE UTILISATEUR (Info du vendeur):
Titre : ${title}
${description ? `Description fournie : ${description}` : ''}

Sois critique sur le titre et la description fournis. Si tu penses qu'elle est fausse, tiens en compte dans l'estimation. Celle-ci étant fournie par le vendeur, elles peuvent être inexactes.

Pour déterminer le designer, base toi sur tes connaissances et les produits de référence plus que sur le nom et la description fournis qui peuvent être fausses ou inexactes (fournis par le vendeur).
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
  "confidence": <nombre entre 0.1 et 1.0>,
  "bestMatchSource": "<nom du partenaire qui a fourni le produit le plus proche>" (optionnel)
}

Exemple de réponse valide :
{"estimatedMinPrice": 500, "estimatedMaxPrice": 1200, "description": "Chaise vintage en bois...", "confidence": 0.75, "bestMatchSource": "Pamono"}
    `.trim()
  }

  protected buildPreEstimationPrompt(title: string, description?: string, categories?: string[]): string {
    let categoriesSection = ''
    if (categories && categories.length > 0) {
      const categoriesList = categories.map(c => `- ${c.replace(/_/g, ' ')}`).join('\n')
      categoriesSection = `\nCATÉGORIES QUE NOUS GÉRONS (ces catégories incluent leurs variantes : table d'appoint = table basse, desserte = table basse, console = bibliothèque/enfilade, etc.) :\n${categoriesList}\n`
    }
    
    return `
Analyse l'image et les informations ci-dessous pour faire une pré-estimation et déterminer si le produit mérite une analyse approfondie.

CONTEXTE UTILISATEUR (Info du vendeur) :
Titre : ${title}
${description ? `Description fournie : ${description}` : ''}${categoriesSection}

TA MISSION :
1. FILTRAGE : Détermine si ce produit est :
   - Une "daube" (produit de mauvaise qualité, sans valeur)
   - Un produit qui ne correspond à aucune de nos catégories (ex: vêtements, électronique, jouets, voitures, etc.)
   - Si c'est le cas, retourne shouldProceed: false

2. PRÉ-ESTIMATION : Estime rapidement la fourchette de prix potentielle (marché secondaire)

3. DÉTECTION DE DESIGNER : Identifie si tu as des soupçons forts (certitude ${Math.round(env.SEARCH_TERM_MIN_CONFIDENCE * 100)}%+) sur un designer ou fabricant connu, pour identifier le designer, base toi sur tes connaissances et sur l'analyse de la photo, plus que sur le nom et la description fournis qui peuvent être fausses ou inexactes (fournis par le vendeur).

4. GÉNÉRATION DE TERMES DE RECHERCHE : Si tu as identifié un designer ou des designers avec certitude ${Math.round(env.SEARCH_TERM_MIN_CONFIDENCE * 100)}%+ et que la pré-estimation est prometteuse, génère jusqu'à 4 termes de recherche optimisés pour trouver ce produit sur des sites spécialisés (AuctionFR, Pamono, 1stdibs, Selency), ça peut être des recherches sur des designes différents si tu as un doute.
   - Chaque terme doit inclure le nom du designer et des caractéristiques clés (matériaux, forme, style)
   - Exemples : "table basse verre rectangulaire maison jansen", "chaise scandinave teck finn juhl"

RÈGLES IMPORTANTES :
- Si la pré-estimation est trop basse (< ${env.MIN_MARGIN_IN_EUR}€), retourne isPromising: false
- Si pas de soupçons de designer renommé (certitude < ${Math.round(env.SEARCH_TERM_MIN_CONFIDENCE * 100)}%), retourne hasDesigner: false et shouldProceed: false
- Les searchTerms ne doivent être générés que si hasDesigner: true ET isPromising: true
- Maximum 4 searchTerms

INSTRUCTIONS DE SORTIE (JSON UNIQUEMENT) :
Tu dois fournir ta réponse UNIQUEMENT au format JSON valide, sans texte avant ou après.
Le JSON doit respecter ce schéma :
{
  "estimatedMinPrice": <nombre en euros>,
  "estimatedMaxPrice": <nombre en euros>,
  "isPromising": <boolean>,
  "hasDesigner": <boolean>,
  "shouldProceed": <boolean>,
  "searchTerms": [
    {
      "query": "table basse verre rectangulaire maison jansen",
      "confidence": <nombre entre ${env.SEARCH_TERM_MIN_CONFIDENCE} et 1.0>
    },
    {
      "query": "table basse verre rectangulaire maison charles",
      "confidence": <nombre entre ${env.SEARCH_TERM_MIN_CONFIDENCE} et 1.0>
    }
  ],
  "description": "<texte d'analyse>",
  "confidence": <nombre entre 0.1 et 1.0>
}

Exemple :
{"estimatedMinPrice": 2000, "estimatedMaxPrice": 5000, "isPromising": true, "hasDesigner": true, "shouldProceed": true, "searchTerms": [{"query": "table basse verre rectangulaire maison jansen", "designer": "Maison Jansen", "confidence": 0.85}], "description": "Table basse vintage...", "confidence": 0.75}
    `.trim()
  }

  protected buildSearchPrompt(title: string, description?: string): string {
    return `
Analyse l'image et les informations ci-dessous pour identifier l'objet et générer une recherche précise.

CONTEXTE UTILISATEUR :
Titre : ${title}
${description ? `Description fournie : ${description}` : ''}

TA MISSION :
1. Identifier l'objet, son style, sa période, et potentiellement son designer ou fabricant.
2. Générer UNE SEULE chaîne de recherche (query) optimisée pour trouver cet objet précis sur un site d'enchères.
   - Sois précis : "table basse verre rectangulaire maison jansen" est mieux que "table basse jansen".
   - Inclus les matériaux, la forme, le designer si connu.
3. Si tu es confiant sur le designer ou la marque, indique-le séparément. Pour déterminer le designer, base toi sur tes connaissances plus que sur le nom et la description fournis qui peuvent être fausses ou inexactes (fournis par le vendeur).

INSTRUCTIONS DE SORTIE (JSON UNIQUEMENT) :
Tu dois fournir ta réponse UNIQUEMENT au format JSON valide, sans texte avant ou après.
Le JSON doit respecter ce schéma :
{
  "searchQuery": "la chaine de recherche précise",
  "designer": "Nom du Designer" (ou null si inconnu)
}

Exemple :
{"searchQuery": "table basse rectangulaire laiton verre maison jansen", "designer": "Maison Jansen"}
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

    const isPromising = parsed.isPromising ?? true
    const hasDesigner = parsed.hasDesigner ?? false
    const shouldProceed = parsed.shouldProceed ?? (isPromising && hasDesigner)
    
    const minConfidence = env.SEARCH_TERM_MIN_CONFIDENCE
    const searchTerms: SearchTerm[] = (parsed.searchTerms || []).slice(0, 4).map((term: any) => ({
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
