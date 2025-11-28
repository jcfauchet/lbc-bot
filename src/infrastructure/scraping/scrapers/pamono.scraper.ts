import { RawListing, SiteScraper } from '@/domain/scraping/types';
import { Browser, Page } from 'playwright';
import { createBrowserForVercel, createBrowserContext } from '../playwright-config';

export class PamonoScraper implements SiteScraper {
  sourceName = 'Pamono';
  private startUrl: string;

  constructor(startUrl?: string) {
    this.startUrl = startUrl || 'https://www.pamono.fr/nouveautes';
  }

  async scrape(): Promise<RawListing[]> {
    console.log(`Starting scrape for ${this.sourceName}...`);
    const browser = await createBrowserForVercel();
    const context = await createBrowserContext(browser);
    const page = await context.newPage();
    const listings: RawListing[] = [];

    try {
      console.log(`Navigating to ${this.startUrl}...`);
      await page.goto(this.startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('Page loaded.');
      
      // Handle Cookie Banner
      try {
        console.log('Checking for cookie banner...');
        const acceptButton = page.getByRole('button', { name: 'Accepter', exact: true }).or(page.getByRole('button', { name: 'Accept', exact: true }));
        if (await acceptButton.isVisible({ timeout: 5000 })) {
            console.log('Clicking cookie accept button...');
            await acceptButton.click();
            await page.waitForTimeout(1000);
        } else {
            console.log('Cookie banner not visible.');
        }
      } catch (e) {
        console.log('No cookie banner found or could not click it.');
      }

      // Get product links from the list page
      console.log('Waiting for product links...');
      // Wait for products to appear - use a.link-wrapper directly
      await page.waitForSelector('a.link-wrapper', { timeout: 10000 });
      
      const productLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a.link-wrapper'));
        return links
          .map(a => (a as HTMLAnchorElement).href)
          .filter(href => href && !href.includes('#') && href.includes('pamono.fr') && href !== window.location.href);
      });

      console.log(`Found ${productLinks.length} products on the first page.`);

      // Scrape all products from the first page
      const linksToScrape = productLinks;
 

      for (const link of linksToScrape) {
        try {
          console.log(`Scraping product: ${link}`);
          const listing = await this.scrapeProductPage(page, link);
          if (listing) {
            listings.push(listing);
          }
        } catch (error) {
          console.error(`Failed to scrape ${link}:`, error);
        }
      }

    } catch (error) {
      console.error('Error during Pamono scrape:', error);
      // Screenshot on error
      await page.screenshot({ path: 'pamono_error.png' });
    } finally {
      await browser.close();
    }

    return listings;
  }

  private async scrapeProductPage(page: Page, url: string): Promise<RawListing | null> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000); // Give page time to render
      
      // Extract title - try multiple selectors
      let title = '';
      try {
        title = await page.locator('h1').first().innerText({ timeout: 5000 });
      } catch {
        try {
          title = await page.locator('[data-test="product-title"]').innerText();
        } catch {
          // Try to get from meta tags
          title = await page.evaluate(() => {
            const metaTitle = document.querySelector('meta[property="og:title"]');
            if (metaTitle) return metaTitle.getAttribute('content') || '';
            const h1 = document.querySelector('h1');
            return h1 ? h1.textContent?.trim() || '' : '';
          });
        }
      }
      
      console.log(`  Title: ${title ? title.substring(0, 50) : 'NOT FOUND'}`);
      if (!title) {
        console.log(`  Skipping ${url} - no title found`);
        return null;
      }

      // Extract price - try multiple approaches
      const priceText = await page.evaluate(() => {
        // Try various price selectors
        const selectors = [
          '.price',
          '[data-test="price"]',
          '[class*="price"]',
          '[class*="Price"]'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            return el.textContent.trim();
          }
        }
        
        // Look for text containing € or EUR
        const allText = document.body.innerText;
        const priceMatch = allText.match(/\d[\d\s,]*\s*€/);
        return priceMatch ? priceMatch[0] : '';
      });
      
      const price = this.parsePrice(priceText);
      const currency = this.parseCurrency(priceText) || 'EUR';
      console.log(`  Price: ${price || 'NOT FOUND'} ${currency}`);

      // Description
      const description = await page.evaluate(() => {
        // Try to find description
        const descSelectors = [
          '.description-content',
          '[data-test="description"]',
          '.product-description',
          '[class*="description"]'
        ];
        
        for (const selector of descSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent) {
            return el.textContent.trim();
          }
        }
        return '';
      });

      // Specs
      const specs = await page.evaluate(() => {
        const data: Record<string, string> = {};
        const dts = Array.from(document.querySelectorAll('dt'));
        dts.forEach(dt => {
          const key = dt.innerText.trim().replace(':', '');
          const dd = dt.nextElementSibling as HTMLElement;
          if (dd && dd.tagName === 'DD') {
            data[key] = dd.innerText.trim();
          }
        });
        return data;
      });

      const brand = specs['Fabricant'] || specs['Manufacturer'] || undefined;
      const condition = specs['Etat'] || specs['Condition'] || undefined;
      const designer = brand; // On Pamono, Fabricant is often the designer
      const period = specs['Période de design'] || specs['Design Period'] || undefined;
      const material = specs['Matériaux'] || specs['Materials'] || undefined;
      const style = specs['Style'] || undefined;

      // Try to extract category from breadcrumb or URL
      const category = await page.evaluate(() => {
        // Look for breadcrumb navigation
        const breadcrumbs = Array.from(document.querySelectorAll('nav a, .breadcrumb a'));
        if (breadcrumbs.length > 1) {
          // Usually: Home > Category > SubCategory > Product
          const categoryLink = breadcrumbs[1] as HTMLAnchorElement;
          return categoryLink?.textContent?.trim();
        }
        return undefined;
      });

      // Images
      const imageUrls = await page.evaluate(() => {
        const images: string[] = [];
        const imgElements = Array.from(document.querySelectorAll('img'));
        imgElements.forEach(img => {
          const src = img.src || img.getAttribute('data-src');
          if (src && !src.includes('icon') && !src.includes('logo')) {
            images.push(src);
          }
        });
        return [...new Set(images)].slice(0, 10); // Limit to 10 images
      });

      console.log(`  Images: ${imageUrls.length} found`);

      return {
        sourceName: this.sourceName,
        sourceListingId: url.split('/').pop()?.split('.')[0] || url,
        url,
        title,
        description: description || undefined,
        brand,
        model: undefined,
        category,
        subCategory: undefined, // Could be extracted from breadcrumb[2] if needed
        designer,
        period,
        material,
        style,
        condition,
        price,
        currency,
        imageUrls,
        scrapedAt: new Date(),
      };
    } catch (error) {
      console.error(`Error scraping product page ${url}:`, error);
      return null;
    }
  }

  private parsePrice(text: string): number | undefined {
    if (!text) return undefined;
    const clean = text.replace(/[^0-9,.]/g, '').replace(',', '.');
    return parseFloat(clean);
  }

  private parseCurrency(text: string): string {
    if (text.includes('€')) return 'EUR';
    if (text.includes('$')) return 'USD';
    if (text.includes('£')) return 'GBP';
    return 'EUR'; // Default
  }
}
