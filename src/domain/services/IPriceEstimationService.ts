import { Money } from '../value-objects/Money'

export interface PriceEstimationResult {
  estimatedMinPrice: Money
  estimatedMaxPrice: Money
  description: string
  confidence?: number
}

export interface ReferenceProduct {
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
}

export interface IPriceEstimationService {
  readonly providerName: string
  preEstimate(
    images: string[],
    title: string,
    description?: string,
    categories?: string[]
  ): Promise<PreEstimationResult>
  
  estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts?: ReferenceProduct[]
  ): Promise<FinalEstimationResult>

  analyzeForSearch(
    images: string[],
    title: string,
    description?: string
  ): Promise<SearchAnalysisResult>
}

export interface SearchAnalysisResult {
  searchQuery: string
  designer?: string
}

export interface PreEstimationResult {
  estimatedMinPrice: Money
  estimatedMaxPrice: Money
  isPromising: boolean
  hasDesigner: boolean
  shouldProceed: boolean
  searchTerms: SearchTerm[]
  description: string
  confidence?: number
}

export interface SearchTerm {
  query: string
  designer?: string
  confidence: number
}

export interface FinalEstimationResult extends PriceEstimationResult {
  bestMatchSource?: string
  bestMatchUrl?: string
}

