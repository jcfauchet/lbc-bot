import { RawListing, SiteScraper } from '@/domain/scraping/types';
import { Browser, Page } from 'playwright';
import { createBrowserForVercel, createBrowserContext } from '../playwright-config';

export class FirstDibsScraper implements SiteScraper {
  sourceName = '1stdibs';
  private startUrl: string;

  constructor(startUrl?: string) {
    this.startUrl = startUrl || 'https://www.1stdibs.com/fr/new-arrivals';
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
      
      await page.waitForTimeout(3000);

      try {
        console.log('Checking for cookie banner...');
        const acceptButton = page.getByRole('button', { name: /accept|accepter|ok|i agree/i });
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

      console.log('Waiting for product links...');
      await page.waitForSelector('[data-tn="search-results-container"]', { timeout: 10000 });
      
      const productLinks = await page.evaluate(() => {
        const container = document.querySelector('[data-tn="search-results-container"]');
        if (!container) return [];
        
        const links = Array.from(container.querySelectorAll('a'));
        return links
          .map(a => (a as HTMLAnchorElement).href)
          .filter(href => href && !href.includes('#') && href.includes('1stdibs.com') && href !== window.location.href);
      });

      console.log(`Found ${productLinks.length} products on the first page.`);

      for (const link of productLinks) {
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
      console.error('Error during 1stdibs scrape:', error);
      await page.screenshot({ path: '1stdibs_error.png' });
    } finally {
      await browser.close();
    }

    return listings;
  }

  private async scrapeProductPage(page: Page, url: string): Promise<RawListing | null> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      const title = await page.locator('[data-tn="pdp-main-title"]').innerText({ timeout: 5000 }).catch(() => '');
      
      console.log(`  Title: ${title ? title.substring(0, 50) : 'NOT FOUND'}`);
      if (!title) {
        console.log(`  Skipping ${url} - no title found`);
        return null;
      }

      const priceText = await page.locator('[data-tn="price-amount"]').innerText({ timeout: 5000 }).catch(() => '');
      const price = this.parsePrice(priceText);
      const currency = this.parseCurrency(priceText) || 'EUR';
      console.log(`  Price: ${price || 'NOT FOUND'} ${currency}`);

      const description = await page.locator('[data-tn="pdp-item-description-content"]').innerText({ timeout: 5000 }).catch(() => '');

      const specs: Record<string, string> = await page.evaluate(() => {
        const data: Record<string, string> = {};
        const specTitles = Array.from(document.querySelectorAll('[data-tn="pdp-spec-title"]'));
        specTitles.forEach(titleElement => {
          const key = titleElement.textContent?.trim().replace(':', '') || '';
          const parent = titleElement.closest('li');
          if (parent) {
            const valueElement = parent.querySelector('[data-tn^="pdp-spec-detail-"]');
            if (valueElement) {
              let value = '';
              if (key === 'Matériaux et techniques') {
                value = Array.from(valueElement.querySelectorAll('a, span')).map(el => el.textContent?.trim()).filter(Boolean).join(', ');
              } else if (key === 'État') {
                value = Array.from(valueElement.querySelectorAll('button, span')).map(el => el.textContent?.trim()).filter(Boolean).join('. ');
              } else {
                value = valueElement.textContent?.trim() || '';
              }
              if (key && value) {
                data[key] = value;
              }
            }
          }
        });
        return data;
      });

      const brand = specs['Maker'] || specs['Designer'] || specs['Brand'] || specs['Fabricant'] || undefined;
      const condition = specs['État'] || specs['Condition'] || undefined;
      const designer = specs['Designer'] || specs['Design'] || brand;
      const period = specs['Période'] || specs['Period'] || specs['Date de fabrication'] || undefined;
      const material = specs['Matériaux et techniques'] || specs['Materials'] || specs['Material'] || undefined;
      const style = specs['Style'] || undefined;

      const category = await page.evaluate(() => {
        const breadcrumbs = Array.from(document.querySelectorAll('nav[aria-label="Fil d\'Ariane"] a[data-tn="breadcrumb-item"]'));
        if (breadcrumbs.length > 1) {
          return breadcrumbs[breadcrumbs.length - 2]?.textContent?.trim();
        }
        return undefined;
      });

      const imageUrls = await page.evaluate(() => {
        const images: string[] = [];
        const carousel = document.querySelector('div[data-tn="pdp-image-carousel"]');
        if (carousel) {
          const mainImages = Array.from(carousel.querySelectorAll('img'));
          mainImages.forEach(img => {
            const src = (img as HTMLImageElement).src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('placeholder')) {
              images.push(src);
            }
          });
        }

        const thumbButtons = Array.from(document.querySelectorAll('button[data-tn="carousel-thumb"]'));
        thumbButtons.forEach(button => {
          const img = button.querySelector('img');
          if (img) {
            const src = (img as HTMLImageElement).src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('placeholder')) {
              images.push(src);
            }
          }
        });

        return [...new Set(images)].slice(0, 10);
      });

      console.log(`  Images: ${imageUrls.length} found`);

      const sourceListingId = url.split('/').pop()?.split('?')[0] || url.split('/').slice(-2).join('-') || url;

      return {
        sourceName: this.sourceName,
        sourceListingId,
        url,
        title,
        description: description || undefined,
        brand,
        model: undefined,
        category,
        subCategory: undefined,
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
    const clean = text.replace(/[^0-9,.]/g, '').replace(/,/g, '');
    return parseFloat(clean);
  }

  private parseCurrency(text: string): string {
    if (text.includes('€') || text.includes('EUR')) return 'EUR';
    if (text.includes('$') || text.includes('USD')) return 'USD';
    if (text.includes('£') || text.includes('GBP')) return 'GBP';
    return 'USD';
  }
}

