import { Browser, Page, BrowserContext } from 'playwright-core'
import { ScrapedListing } from '../types'
import { IListingSource } from '@/domain/services/IListingSource'
import { env } from '../../config/env'
import { createBrowser, createBrowserContext } from '../playwright-config'
import { v2 as cloudinary } from 'cloudinary'

export class LeBonCoinListingScraper implements IListingSource {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  async search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]> {
    try {
      await this.initBrowser()
      const page = await this.context!.newPage()

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

      // Wait longer to simulate human behavior
      await this.randomDelay(3000, 6000)
      
      // Simulate mouse movement
      await page.mouse.move(Math.random() * 500, Math.random() * 500)
      await this.randomDelay(500, 1500)
      
      await this.checkForBotDetection(page)

      try {
        const cookieButton = await page.waitForSelector('#didomi-notice-agree-button, #didomi-notice-learn-more-button', { timeout: 5000 })
        if (cookieButton) {
            // Simulate human-like delay before clicking
            await this.randomDelay(1000, 2500)
            
            const refuseButton = await page.$('button:has-text("Refuser"), button:has-text("Continuer sans accepter")')
            if (refuseButton) {
                // Move mouse to button before clicking
                const box = await refuseButton.boundingBox()
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
                  await this.randomDelay(200, 500)
                }
                await refuseButton.click({ delay: Math.random() * 100 + 50 })
            } else {
                 // Move mouse to button before clicking
                 const box = await cookieButton.boundingBox()
                 if (box) {
                   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
                   await this.randomDelay(200, 500)
                 }
                 await cookieButton.click({ delay: Math.random() * 100 + 50 })
                 const refuseAll = await page.waitForSelector('button:has-text("Refuser tout")', { timeout: 2000 }).catch(() => null)
                 if (refuseAll) {
                   await this.randomDelay(500, 1000)
                   await refuseAll.click({ delay: Math.random() * 100 + 50 })
                 }
            }
            // Wait after cookie interaction
            await this.randomDelay(1000, 2000)
        }
      } catch (e: any) {
        if (e?.name !== 'TimeoutError') {
          console.log('Cookie banner error:', e)
        }
      }

      let listingsSelector = '';
      try {
        await page.waitForSelector('ul[data-test-id="listing-mosaic"]', {
            timeout: 5000,
        });
        listingsSelector = 'ul[data-test-id="listing-mosaic"] > li';
      } catch (e) {
        try {
          await page.waitForSelector('ul[data-test-id="listing-column"]', {
            timeout: 10000,
          });
          listingsSelector = 'ul[data-test-id="listing-column"] > li';
        } catch (e2) {
          console.error('Listings container not found with either selector');
          console.error(`Page URL: ${page.url()}`);
          console.error(`Page title: ${await page.title().catch(() => 'unknown')}`);
          
          throw new Error('Could not find listings container');
        }
      }

      console.log(`Using selector: ${listingsSelector}`);

      await this.autoScroll(page);

      const listings = await page.$$eval(
        listingsSelector,
        (elements) => {
          return elements.map((el) => {
            const linkEl = el.querySelector('a');
            const titleEl = el.querySelector('h3') || 
                           el.querySelector('p[data-test-id="adcard-title"]') ||
                           el.querySelector('[data-qa-id="adcard_title"]');
            const priceEl = el.querySelector('[data-test-id="price"]') ||
                           el.querySelector('[data-qa-id="adcard_price"]');
            const imageEl = el.querySelector('[data-test-id="adcard-image"] img') ||
                           el.querySelector('img[alt]');

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

  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private async checkForBotDetection(page: Page): Promise<void> {
    // Removed - we want to try to pass through, not detect and fail
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
      const page = await this.context!.newPage()

      await page.goto(listingUrl, { waitUntil: 'domcontentloaded' })

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
      this.browser = await createBrowser()
      this.context = await createBrowserContext(this.browser)
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close()
      this.context = null
    }
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}

