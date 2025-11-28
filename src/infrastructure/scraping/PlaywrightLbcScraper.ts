import { chromium, Browser, Page } from 'playwright'
import { IScraper, ScrapedListing } from './types'
import { env } from '../config/env'

export class PlaywrightScraper implements IScraper {
  private browser: Browser | null = null

  async scrape(searchUrl: string): Promise<ScrapedListing[]> {
    try {
      await this.initBrowser()
      const page = await this.browser!.newPage()

      // Set a realistic user agent to avoid immediate blocking
      await page.setExtraHTTPHeaders({
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

      // Handle cookie banner
      try {
        const cookieButton = await page.waitForSelector('#didomi-notice-agree-button, #didomi-notice-learn-more-button', { timeout: 5000 })
        if (cookieButton) {
            // Try to refuse if possible, otherwise accept or learn more -> refuse
            // For now, let's try to find "Refuser" or "Continuer sans accepter"
            const refuseButton = await page.$('button:has-text("Refuser"), button:has-text("Continuer sans accepter")')
            if (refuseButton) {
                await refuseButton.click()
            } else {
                 // Fallback: click the first available button found (likely Accept or Learn More)
                 // If we clicked Learn More, we might need to look for Refuse again.
                 // Simpler approach for now: just try to get past it.
                 await cookieButton.click()
                 // If we clicked "En savoir plus" (Learn more), try to find "Refuser tout"
                 const refuseAll = await page.waitForSelector('button:has-text("Refuser tout")', { timeout: 2000 }).catch(() => null)
                 if (refuseAll) await refuseAll.click()
            }
        }
      } catch (e) {
        // Cookie banner might not appear or is different, continue
        console.log('Cookie banner not found or handled:', e)
      }

      // Wait for listings - try multiple selectors for different page layouts
      let listingsSelector = '';
      try {
        // Try the mosaic layout first (with category parameter)
        await page.waitForSelector('ul[data-test-id="listing-mosaic"]', {
            timeout: 5000,
        });
        listingsSelector = 'ul[data-test-id="listing-mosaic"] > li';
      } catch (e) {
        // Try alternative selector (without category parameter - uses listing-column)
        try {
          await page.waitForSelector('ul[data-test-id="listing-column"]', {
            timeout: 10000,
          });
          listingsSelector = 'ul[data-test-id="listing-column"] > li';
        } catch (e2) {
          console.error('Listings container not found with either selector');
          await page.screenshot({ path: 'debug_listings_not_found.png' });
          throw new Error('Could not find listings container');
        }
      }

      console.log(`Using selector: ${listingsSelector}`);

      // Scroll to load lazy images
      await this.autoScroll(page);

      const listings = await page.$$eval(
        listingsSelector,
        (elements) => {
          return elements.map((el) => {
            const linkEl = el.querySelector('a');
            const titleEl = el.querySelector('h3') || 
                           el.querySelector('p[data-test-id="adcard-title"]') ||
                           el.querySelector('[data-qa-id="adcard_title"]'); // Additional fallback
            const priceEl = el.querySelector('[data-test-id="price"]') ||
                           el.querySelector('[data-qa-id="adcard_price"]'); // Additional fallback
            const imageEl = el.querySelector('[data-test-id="adcard-image"] img') ||
                           el.querySelector('img[alt]'); // Additional fallback

            const url = linkEl?.getAttribute('href') || '';
            const lbcId = url.split('/').pop()?.split('.')[0] || '';
            const title = titleEl?.textContent?.trim() || '';
            
            const priceText = priceEl?.textContent?.trim() || '0';
            const priceMatch = priceText.match(/[\d\s]+/);
            const priceEuros = priceMatch
              ? parseInt(priceMatch[0].replace(/\s/g, ''))
              : 0;

            let imageUrl = '';
            if (imageEl) {
              const imgEl = imageEl as HTMLImageElement;
              imageUrl = 
                imgEl.getAttribute('src') || 
                imgEl.getAttribute('data-src') || 
                imgEl.getAttribute('data-lazy-src') ||
                imgEl.srcset?.split(',')[0]?.trim().split(' ')[0] || 
                '';
            }

            return {
              lbcId,
              url: url.startsWith('http') ? url : `https://www.leboncoin.fr${url}`,
              title,
              priceCents: priceEuros * 100,
              city: '',
              region: '',
              imageUrls: imageUrl ? [imageUrl] : [],
            };
          });
        }
      );

      await page.close();

      return listings
        .filter((l) => l.lbcId && l.title)
        .filter((l) => l.priceCents >= env.MIN_LISTING_PRICE_EUR * 100);
    } catch (error) {
      console.error('Scraping error:', error)
      throw error
    }
  }

  private async autoScroll(page: Page) {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0
        const distance = 100
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance

          if (totalHeight >= scrollHeight - window.innerHeight) {
            clearInterval(timer)
            resolve()
          }
        }, 100)
      })
    })
  }

  async scrapeDetails(listingUrl: string): Promise<{
    description?: string
    imageUrls: string[]
  }> {
    try {
      await this.initBrowser()
      const page = await this.browser!.newPage()

      await page.goto(listingUrl, { waitUntil: 'domcontentloaded' })

      // Handle cookie banner here too if needed, or reuse logic

      const description = await page
        .$eval('[data-qa-id="adview_description_container"]', (el) =>
          el.textContent?.trim()
        )
        .catch(() => undefined)

      const imageUrls = await page
        .$$eval('img[data-qa-id="slideshow_image"]', (imgs) =>
          imgs.map((img) => {
            const imgEl = img as HTMLImageElement
            return (
              imgEl.getAttribute('src') ||
              imgEl.getAttribute('data-src') ||
              imgEl.srcset?.split(',')[0]?.trim().split(' ')[0] ||
              ''
            )
          }).filter(Boolean)
        )
        .catch(() => [])

      await page.close()

      return {
        description,
        imageUrls: imageUrls as string[],
      }
    } catch (error) {
      console.error('Detail scraping error:', error)
      return { imageUrls: [] }
    }
  }

  private async initBrowser(): Promise<void> {
    if (!this.browser) {
      const isDev = env.NODE_ENV === 'development'
      this.browser = await chromium.launch({
        headless: !isDev,
        slowMo: isDev ? 100 : 0,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      })
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}
