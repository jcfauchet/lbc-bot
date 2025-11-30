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
      const searchUrl = `${this.baseUrl}/recherche?q=${encodeURIComponent(searchQuery)}`;
      console.log(`Navigating to ${searchUrl}...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      try {
        const acceptButton = page.getByRole('button', { name: /accepter|accept/i }).first();
        if (await acceptButton.isVisible({ timeout: 5000 })) {
            await acceptButton.click();
        }
      } catch (e) {
      }

      console.log('Waiting for product links...');
      try {
        await page.waitForSelector('.product-card, [data-testid="product-card"]', { timeout: 10000 });
      } catch (e) {
        console.log('No results found on Selency.');
        return [];
      }
      
      const productLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('.product-card a, [data-testid="product-card"] a'));
        return links
          .map(a => (a as HTMLAnchorElement).href)
          .filter(href => href && !href.includes('#') && href.includes('selency.fr'));
      });

      console.log(`Found ${productLinks.length} products. Scraping top 5...`);

      for (const link of productLinks.slice(0, 5)) {
        try {
          const product = await this.scrapeProductPage(page, link);
          if (product) {
            results.push(product);
          }
        } catch (error) {
          console.error(`Failed to scrape ${link}:`, error);
        }
      }

    } catch (error) {
      console.error('Error during Selency scrape:', error);
    } finally {
      await browser.close();
    }

    return results;
  }

  private async scrapeProductPage(page: Page, url: string): Promise<ReferenceProduct | null> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const title = await page.locator('h1').first().innerText().catch(() => '');
      if (!title) return null;

      const priceText = await page.locator('.price, [data-testid="price"]').first().innerText().catch(() => '');
      const price = this.parsePrice(priceText);
      
      if (!price) return null;

      const imageUrls = await page.evaluate(() => {
        const images: string[] = [];
        const imgElements = Array.from(document.querySelectorAll('.product-image img, [data-testid="product-image"] img'));
        imgElements.forEach(img => {
            const src = (img as HTMLImageElement).src || img.getAttribute('data-src');
            if (src) images.push(src);
        });
        return images.slice(0, 5);
      });


      return {
        title,
        price,
        currency: 'EUR',
        source: 'Selency',
        url,
        imageUrls,
      };
    } catch (error) {
      return null;
    }
  }

  private parsePrice(text: string): number | undefined {
    if (!text) return undefined;
    const clean = text.replace(/[^0-9,.]/g, '').replace(',', '.');
    return parseFloat(clean);
  }
}

