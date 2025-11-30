import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';

import { Page } from 'playwright-core';
import { IReferenceScraper } from '../IReferenceScraper';
import { createBrowser, createBrowserContext } from '../../playwright-config';

export class PamonoScraper implements IReferenceScraper {
  private readonly baseUrl = 'https://www.pamono.fr';

  async scrape(searchQuery: string): Promise<ReferenceProduct[]> {
    console.log(`Starting Pamono scrape for query: "${searchQuery}"...`);
    const browser = await createBrowser();
    const context = await createBrowserContext(browser);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      const searchUrl = `${this.baseUrl}/catalogsearch/result/?q=${encodeURIComponent(searchQuery)}`;
      console.log(`Navigating to ${searchUrl}...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      try {
        const acceptButton = page.getByRole('button', { name: /accepter|accept/i }).first();
        if (await acceptButton.isVisible({ timeout: 5000 })) {
            await acceptButton.click();
            await page.waitForTimeout(1000);
        }
      } catch (e) {
      }

      console.log('Waiting for product cards...');
      try {
        await page.waitForSelector('article.product-card', { timeout: 10000 });
      } catch (e) {
        console.log('No results found on Pamono.');
        return [];
      }
      
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(2000);
      
      const products = await page.evaluate(() => {
        const productCards = Array.from(document.querySelectorAll('article.product-card'));
        const results: any[] = [];
        
        for (const card of productCards.slice(0, 10)) {
          try {
            const linkEl = card.querySelector('a.link-wrapper') as HTMLAnchorElement;
            if (!linkEl) continue;
            
            const url = linkEl.href;
            const titleEl = card.querySelector('p.title');
            const title = titleEl?.textContent?.trim() || '';
            
            if (!title) continue;
            
            const availabilityEl = card.querySelector('.availability .on-hold');
            if (availabilityEl && availabilityEl.textContent?.includes('Réservé')) {
              continue;
            }
            
            let price: number | undefined;
            const specialPriceEl = card.querySelector('.special-price .price');
            const regularPriceEl = card.querySelector('.regular-price .price');
            
            const priceEl = specialPriceEl || regularPriceEl;
            if (priceEl) {
              const priceText = priceEl.textContent || '';
              const priceContent = priceEl.getAttribute('content') || priceEl.getAttribute('itemprop') === 'price' ? priceEl.getAttribute('content') : null;
              
              if (priceContent) {
                price = parseFloat(priceContent);
              } else {
                const clean = priceText.replace(/[^\d,]/g, '').replace(',', '.');
                price = parseFloat(clean);
              }
            }
            
            if (!price || price <= 0) continue;
            
            const imageUrls: string[] = [];
            const imageEl = card.querySelector('img.image') as HTMLImageElement;
            if (imageEl) {
              let src = imageEl.getAttribute('data-lazy');
              if (!src || src.includes('data:image/gif')) {
                src = imageEl.src;
              }
              if (!src || src.includes('data:image/gif') || src.includes('base64')) {
                const noscriptEl = card.querySelector('noscript img');
                if (noscriptEl) {
                  src = noscriptEl.getAttribute('src') || '';
                }
              }
              if (src && !src.includes('data:image/gif') && !src.includes('base64') && src.startsWith('http')) {
                imageUrls.push(src);
              }
            }
            
            results.push({
              title,
              price,
              url,
              imageUrls,
            });
          } catch (e) {
            console.error('Error parsing product card:', e);
          }
        }
        
        return results;
      });

      console.log(`Found ${products.length} products from Pamono`);

      for (const product of products) {
        results.push({
          title: product.title,
          price: product.price,
          currency: 'EUR',
          source: 'Pamono',
          url: product.url,
          imageUrls: product.imageUrls || [],
        });
      }

    } catch (error) {
      console.error('Error during Pamono scrape:', error);
    } finally {
      await browser.close();
    }

    return results;
  }
}

