import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';
import { IReferenceScraper } from '../IReferenceScraper';
import { createStealthBrowser, createStealthBrowserContext, randomDelay } from '../../playwright-config';
import { Page, Response } from 'playwright-core';

export class AuctionFrScraper implements IReferenceScraper {
  private readonly baseUrl = 'https://www.auction.fr';

  constructor(
    private email = process.env.AUCTION_FR_EMAIL,
    private password = process.env.AUCTION_FR_PASSWORD
  ) {}

  async scrape(searchQuery: string): Promise<ReferenceProduct[]> {
    if (!this.email || !this.password) {
      console.warn('AuctionFrScraper: Missing credentials');
      return [];
    }

    const browser = await createStealthBrowser();
    const context = await createStealthBrowserContext(browser);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      await this.login(page);

      const searchUrl = `${this.baseUrl}/resultats-des-ventes/lots?search=${encodeURIComponent(searchQuery)}&pricingIsConfirmed=1`;
      console.log(`Navigating to ${searchUrl}...`);

      const apiResponsePromise = page.waitForResponse(
        (response: Response) => response.url().includes('v1/search/thor_past_items') && response.request().method() === 'GET',
        { timeout: 30000 }
      );

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      
      await page.waitForTimeout(randomDelay());
      await page.mouse.move(200, 300);
      await page.evaluate(() => window.scrollBy(0, 250));
      await page.waitForTimeout(randomDelay());

      let apiResponse;
      try {
        apiResponse = await apiResponsePromise;
      } catch (e) {
        console.log('No API response intercepted, returning empty results');
        return [];
      }

      const jsonResponse = await apiResponse.json();
      console.log('API Response received. First item structure:', JSON.stringify(jsonResponse[0], null, 2));

      if (jsonResponse && Array.isArray(jsonResponse)) {
        for (const item of jsonResponse.slice(0, 10)) {
          try {
            const title = item.description_translations?.['fr-FR'] || item.description || item.title_translations?.['fr-FR'] || 'Untitled';
            const link = `${this.baseUrl}/lot/${item.slug}-${item.id}`;
            
            let price: number | undefined;
            let currency: string = item.sale?.currency || 'EUR';

            if (item.pricing?.auctioned?.sold && item.pricing.auctioned.price) {
                price = item.pricing.auctioned.price;
                currency = item.sale?.currency || 'EUR';
            } else if (item.pricing?.estimates?.min && item.pricing.estimates.max) {
                price = (item.pricing.estimates.min + item.pricing.estimates.max) / 2;
                currency = item.pricing.estimates.currency || item.sale?.currency || 'EUR';
            } else {
                console.log(`Item ${item.id}: No valid price found (not sold and no estimates). Skipping.`);
                continue;
            }

            let imageUrls: string[] = [];
            if (item.medias && Array.isArray(item.medias) && item.medias.length > 0) {
              const primaryImage = item.medias.find((media: any) => media.type === 'item_picture' && media.rank === 0) || item.medias[0];
              if (primaryImage && primaryImage.url) {
                let url = primaryImage.url;
                if (url.startsWith('//')) {
                  url = `https:${url}`;
                }
                imageUrls.push(url);
              }
            }

            results.push({
              title,
              price,
              currency,
              source: 'auction.fr',
              url: link,
              imageUrls,
            } as ReferenceProduct);
          } catch (e) {
            console.error(`Error parsing item from API response (ID: ${item.id}):`, e);
          }
        }
      }

    } catch (error) {
      console.error('AuctionFrScraper error:', error);
    } finally {
      await browser.close();
    }

    return results;
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async humanBehavior(page: Page) {
    // random mouse moves
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(Math.random() * 700) + 100;
      const y = Math.floor(Math.random() * 500) + 100;
      await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 20) + 5 });
      await this.sleep(Math.random() * 400 + 200);
    }
  
    // scroll down in chunks
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      });
      await this.sleep(Math.random() * 700 + 500);
    }
  
    // pause and scroll up
    await this.sleep(Math.random() * 500 + 500);
    await page.evaluate(() => {
      window.scrollBy(0, -window.innerHeight * 0.5);
    });
    await this.sleep(Math.random() * 500 + 300);
  
    // random click
    // const bx = Math.floor(Math.random() * 700) + 50;
    // const by = Math.floor(Math.random() * 500) + 50;
    // await page.mouse.click(bx, by);
    // await this.sleep(Math.random() * 1000 + 1000);
  }

  private async humanLikeInteraction(page: Page) {
    await page.mouse.move(100, 100);
    await page.waitForTimeout(randomDelay(500, 1000));
    await page.mouse.move(200, 300);
    await page.waitForTimeout(randomDelay(500, 1000));
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
    await page.waitForTimeout(randomDelay(1000, 2000));
  }

  private async login(page: Page) {
    console.log('Logging in to auction.fr...');
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    
    // Accept cookies if present
    try {
        const acceptButton = page.locator('button.cpm-cookies-bar-cta, button:has-text("Accepter")').first();
        if (await acceptButton.isVisible({ timeout: 5000 })) {
            await acceptButton.click();
            await page.waitForTimeout(1000);
        }
    } catch (e) {
        // Ignore cookie errors
    }

    // Click "Se connecter"
    try {
      // Try multiple selectors for the login button
        await this.humanBehavior(page);

        const loginBtn = page.locator('a[href*="/login"] button, button:has-text("Se connecter"), a:has-text("Se connecter")').first();
        await loginBtn.click();
        await this.humanLikeInteraction(page);
        
        // Wait for modal content (inputs) instead of container class
        // This is more robust as we just need the inputs to be visible
        const emailInput = page.locator('input[type="email"], input[name="login"], input[name="email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 10000 });
        
        await this.humanLikeInteraction(page);
        
        const passwordInput = page.locator('input[type="password"]').first();
        
        await emailInput.fill(this.email!);
        await this.humanLikeInteraction(page);
        await passwordInput.fill(this.password!);
        await this.humanLikeInteraction(page);
        
        // Click submit - look for the button inside the same form/modal
        const submitBtn = page.locator('button:has-text("Me connecter"), button[type="submit"]').last();
        await submitBtn.click();
        
        // Wait a bit for the page to react
        await this.humanLikeInteraction(page);
                
    } catch (e) {
        console.error('Login failed:', e);
        throw e;
    }
    console.log('Login completed');
  }
}
