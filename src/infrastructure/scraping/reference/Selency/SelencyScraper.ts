import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';
import { Page } from 'playwright-core';
import { IReferenceScraper } from '../IReferenceScraper';
import { createBrowser, createBrowserContext } from '../../playwright-config';

export class SelencyScraper implements IReferenceScraper {
  private readonly baseUrl = 'https://www.selency.fr';

  async scrape(searchQuery: string): Promise<ReferenceProduct[]> {
    console.log(`Starting Selency scrape for query: "${searchQuery}"...`);
    const browser = await createBrowser();
    const context = await createBrowserContext(browser);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      const searchUrl = `${this.baseUrl}/search.html?query=${encodeURIComponent(searchQuery)}`;
      console.log(`Navigating to ${searchUrl}...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      try {
        const acceptButton = page.getByRole('button', { name: /accepter|accept/i }).first();
        if (await acceptButton.isVisible({ timeout: 5000 })) {
            await acceptButton.click();
        }
      } catch (e) {
        // Ignore cookie banner errors
      }

      console.log('Waiting for product list...');
      try {
        // Wait for the list items to appear
        await page.waitForSelector('li > div[data-testid="card-product"]', { timeout: 10000 });
      } catch (e) {
        console.log('No results found on Selency.');
        return [];
      }
      
      // Extract data directly from the list page
      results.push(...await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li > div[data-testid="card-product"]'));
        
        return items.map(item => {
          try {
            const titleEl = item.querySelector('h3[data-testid="card-product-title"]');
            const title = titleEl?.textContent?.trim() || '';
            
            // Try to get price from meta tag first, then fallback to display price
            const priceMeta = item.querySelector('meta[itemprop="price"]');
            const priceDisplay = item.querySelector('[data-testid="product-price-value"]');
            let priceText = priceMeta?.getAttribute('content') || priceDisplay?.textContent || '';
            
            // Parse price
            const cleanPrice = priceText.replace(/[^0-9,.]/g, '').replace(',', '.');
            const price = parseFloat(cleanPrice);
            
            const linkEl = item.querySelector('a[data-testid="base-link"]');
            const relativeUrl = linkEl?.getAttribute('href') || '';
            const url = relativeUrl.startsWith('http') ? relativeUrl : `https://www.selency.fr${relativeUrl}`;
            
            const imgEl = item.querySelector('img[itemprop="image"]');
            const imageUrl = imgEl?.getAttribute('src') || '';
            
            if (!title || isNaN(price) || !url) return null;

            return {
              title,
              price,
              currency: 'EUR',
              source: 'Selency',
              url,
              imageUrls: imageUrl ? [imageUrl] : [],
            };
          } catch (e) {
            return null;
          }
        }).filter((item): item is any => item !== null);
      }));

      console.log(`Found ${results.length} products.`);

    } catch (error) {
      console.error('Error during Selency scrape:', error);
    } finally {
      await browser.close();
    }

    return results;
  }
}

