import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';

export interface IReferenceScraper {
  scrape(searchQuery: string): Promise<ReferenceProduct[]>;
}

