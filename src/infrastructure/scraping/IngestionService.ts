import { PrismaClient } from '@prisma/client';
import { RawListing } from '../../domain/scraping/types';
import { AiCategorizationService } from '../ai/AiCategorizationService';

export class IngestionService {
  constructor(
    private prisma: PrismaClient,
    private categorizationService: AiCategorizationService
  ) {}

  async ingestRawListing(raw: RawListing): Promise<void> {
    // 0. Categorize and Filter
    // We pass raw attributes if available (e.g. from Pamono specs) to help categorization
    const rawAttributes = {
      category: raw.category,
      period: raw.period,
      material: raw.material,
      style: raw.style,
      designer: raw.designer
    };

    console.log(`Categorizing listing: ${raw.title}`);
    const categorization = await this.categorizationService.categorize(
      raw.title,
      raw.description,
      rawAttributes
    );

    if (!categorization) {
      console.log(`Skipping listing "${raw.title}" - Out of scope or uncategorized`);
      return;
    }

    console.log(`Categorized as: ${JSON.stringify(categorization)}`);

    // 1. Upsert ProductSource
    const source = await this.prisma.productSource.upsert({
      where: { name: raw.sourceName },
      update: {},
      create: {
        name: raw.sourceName,
        baseUrl: new URL(raw.url).origin,
      },
    });

    // 2. Resolve taxonomy IDs from values
    const categoryId = categorization.category
      ? await this.resolveCategoryId(categorization.category)
      : null;
    const periodId = categorization.period
      ? await this.resolvePeriodId(categorization.period)
      : null;
    const materialId = categorization.material
      ? await this.resolveMaterialId(categorization.material)
      : null;
    const styleId = categorization.style
      ? await this.resolveStyleId(categorization.style)
      : null;

    // 3. Upsert ProductListing
    const listing = await this.prisma.productListing.upsert({
      where: {
        sourceId_sourceListingId: {
          sourceId: source.id,
          sourceListingId: raw.sourceListingId,
        },
      },
      update: {
        url: raw.url,
        title: raw.title,
        description: raw.description,
        categoryId,
        subCategory: raw.subCategory,
        designer: categorization.designer || raw.designer,
        periodId,
        materialId,
        styleId,
        condition: raw.condition,
        price: raw.price,
        currency: raw.currency,
        scrapedAt: raw.scrapedAt,
        updatedAt: new Date(),
      },
      create: {
        sourceId: source.id,
        sourceListingId: raw.sourceListingId,
        url: raw.url,
        title: raw.title,
        description: raw.description,
        categoryId,
        subCategory: raw.subCategory,
        designer: categorization.designer || raw.designer,
        periodId,
        materialId,
        styleId,
        condition: raw.condition,
        price: raw.price,
        currency: raw.currency,
        scrapedAt: raw.scrapedAt,
      },
    });

    // 4. Construct canonicalKey and Upsert Product if possible
    const canonicalKey = this.generateCanonicalKey(raw);
    let productId: string | null = null;

    if (canonicalKey) {
      const productCategoryId = raw.category
        ? await this.resolveCategoryId(raw.category)
        : categoryId;

      const product = await this.prisma.product.upsert({
        where: { canonicalKey },
        update: {
          updatedAt: new Date(),
        },
        create: {
          canonicalKey,
          brand: raw.brand,
          model: raw.model,
          reference: raw.reference,
          categoryId: productCategoryId,
          title: raw.title,
        },
      });
      productId = product.id;

      // Link Listing to Product
      await this.prisma.productListing.update({
        where: { id: listing.id },
        data: { productId },
      });
    }

    // 5. Create PriceHistory
    if (raw.price !== undefined && raw.currency) {
      // Only create price history if we have a product to link to, 
      // OR if we want to track history per listing even without a canonical product.
      // The schema requires productId for PriceHistory. 
      // If we don't have a product, we can't store price history in the PriceHistory table as currently defined.
      // However, the spec says "creer une entree PriceHistory si price et currency sont definis."
      // and "PriceHistory ... productId String".
      // So we can only do this if we have a productId.
      
      if (productId) {
         await this.prisma.priceHistory.create({
          data: {
            productId,
            sourceId: source.id,
            price: raw.price,
            currency: raw.currency,
            observedAt: raw.scrapedAt,
          },
        });
      }
    }

    // 6. Create ProductImages
    if (raw.imageUrls && raw.imageUrls.length > 0) {
      for (const imageUrl of raw.imageUrls) {
        // Simple check to avoid duplicates if needed, or just create.
        // Spec says "creer ProductImage liee au ProductListing (et au Product si connu)."
        // We might want to check if it exists for this listing to avoid infinite duplicates on re-scrape.
        // For now, let's check if an image with this URL exists for this listing.
        const existingImage = await this.prisma.productImage.findFirst({
            where: {
                listingId: listing.id,
                url: imageUrl
            }
        });

        if (!existingImage) {
            await this.prisma.productImage.create({
                data: {
                    listingId: listing.id,
                    productId: productId, // can be null
                    url: imageUrl,
                }
            });
        }
      }
    }
  }

  private async resolveCategoryId(value: string): Promise<string | null> {
    const category = await this.prisma.taxonomyCategory.findUnique({
      where: { value },
    });
    return category?.id || null;
  }

  private async resolvePeriodId(value: string): Promise<string | null> {
    const period = await this.prisma.taxonomyPeriod.findUnique({
      where: { value },
    });
    return period?.id || null;
  }

  private async resolveMaterialId(value: string): Promise<string | null> {
    const material = await this.prisma.taxonomyMaterial.findUnique({
      where: { value },
    });
    return material?.id || null;
  }

  private async resolveStyleId(value: string): Promise<string | null> {
    const style = await this.prisma.taxonomyStyle.findUnique({
      where: { value },
    });
    return style?.id || null;
  }

  private generateCanonicalKey(raw: RawListing): string | null {
    if (!raw.brand || !raw.model) {
      return null;
    }
    
    const parts = [raw.brand, raw.model, raw.reference].filter(Boolean) as string[];
    const normalized = parts.map(p => p.toLowerCase().trim().replace(/\s+/g, ' '));
    const key = normalized.join('|');
    
    return key.length > 0 ? key : null;
  }
}
