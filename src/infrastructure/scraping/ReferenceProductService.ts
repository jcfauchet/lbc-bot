import { PrismaClient, ProductListing } from '@prisma/client';
import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';

export class ReferenceProductService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find similar reference products based on title keywords
   */
  async findSimilarProducts(
    title: string,
    filters?: {
      category?: string;
      period?: string;
      material?: string;
      style?: string;
      designer?: string;
    },
    limit: number = 10
  ): Promise<ReferenceProduct[]> {
    // Extract meaningful keywords from title (remove common words)
    const keywords = this.extractKeywords(title);
    
    const where: any = {
      price: { not: null },
    };

    // Apply structured filters if provided
    if (filters) {
      if (filters.category) {
        const category = await this.prisma.taxonomyCategory.findUnique({
          where: { value: filters.category },
        });
        if (category) where.categoryId = category.id;
      }
      if (filters.period) {
        const period = await this.prisma.taxonomyPeriod.findUnique({
          where: { value: filters.period },
        });
        if (period) where.periodId = period.id;
      }
      if (filters.material) {
        const material = await this.prisma.taxonomyMaterial.findUnique({
          where: { value: filters.material },
        });
        if (material) where.materialId = material.id;
      }
      if (filters.style) {
        const style = await this.prisma.taxonomyStyle.findUnique({
          where: { value: filters.style },
        });
        if (style) where.styleId = style.id;
      }
      if (filters.designer) where.designer = filters.designer;
    }

    // If we have keywords, add them to the query
    if (keywords.length > 0) {
      where.OR = keywords.map(keyword => ({
        title: {
          contains: keyword,
          mode: 'insensitive' as const,
        },
      }));
    }

    // Search for products
    const listings = await this.prisma.productListing.findMany({
      where,
      include: {
        source: true,
        category: true,
        period: true,
        material: true,
        style: true,
        images: {
          take: 3,
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      take: limit,
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    return listings.map(listing => this.toReferenceProduct(listing));
  }

  /**
   * Extract meaningful keywords from title
   * Remove common words and short words
   */
  private extractKeywords(title: string): string[] {
    const commonWords = new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'en', 'a', 'à',
      'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'très', 'bon', 'bonne',
      'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'from'
    ]);

    return title
      .toLowerCase()
      .split(/[\s\-,;:]+/)
      .filter(word => 
        word.length > 3 && 
        !commonWords.has(word) &&
        !/^\d+$/.test(word) // Remove pure numbers
      )
      .slice(0, 5); // Take top 5 keywords
  }

  private toReferenceProduct(listing: ProductListing & {
    source: { name: string };
    category?: { value: string } | null;
    period?: { value: string } | null;
    material?: { value: string } | null;
    style?: { value: string } | null;
    images?: { url: string }[];
  }): ReferenceProduct {
    return {
      title: listing.title || '',
      price: listing.price || 0,
      currency: listing.currency || 'EUR',
      source: listing.source.name,
      designer: listing.designer || undefined,
      period: listing.period?.value || undefined,
      material: listing.material?.value || undefined,
      style: listing.style?.value || undefined,
      url: listing.url,
      imageUrls: listing.images?.map(img => img.url).filter(Boolean) || [],
    };
  }
}
