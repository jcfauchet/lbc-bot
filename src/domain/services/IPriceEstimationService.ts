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
  estimatePrice(
    images: string[],
    title: string,
    description?: string,
    referenceProducts?: ReferenceProduct[]
  ): Promise<PriceEstimationResult>
}

