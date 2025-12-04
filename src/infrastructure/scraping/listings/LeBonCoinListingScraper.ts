import { Browser, Page, BrowserContext } from 'playwright-core'
import { ScrapedListing } from '../types'
import { IListingSource } from '@/domain/services/IListingSource'
import { env } from '../../config/env'
import { createBrowser, createBrowserContext } from '../playwright-config'
import { v2 as cloudinary } from 'cloudinary'
import { CATEGORIES_SLUG_TO_EXCLUDE_FROM_LBC, CATEGORIES_TO_EXCLUDE_FROM_LBC } from '@/infrastructure/config/constants'
import { ProxyManager } from '../../proxy/ProxyManager'

export class LeBonCoinListingScraper implements IListingSource {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private readonly proxyManager: ProxyManager | null

  constructor() {
    this.proxyManager = env.PROXY_ENABLED && env.PROXY_LIST && env.PROXY_LIST.length > 0
      ? new ProxyManager(env.PROXY_LIST)
      : null
    
    if (this.proxyManager) {
      console.log(`🌐 [LeBonCoin Scraper] Proxy rotation enabled with ${this.proxyManager.getProxyCount()} proxies`)
    }
  }

  async search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]> {
    let page: Page | null = null
    try {
      await this.initBrowser()
      page = await this.context!.newPage()

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      } catch (gotoError: any) {
        await this.takeScreenshot(page, `goto-error-${searchName || 'unknown'}`, {
          url: searchUrl,
          error: gotoError.message,
        })
        throw gotoError
      }

      await this.randomDelay(5000, 10000)
      
      await page.mouse.move(Math.random() * 500, Math.random() * 500)
      await this.randomDelay(1000, 2000)
      
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 200 + 100)
      })
      await this.randomDelay(1000, 2000)
      

      try {
        const cookieButton = await page.waitForSelector('#didomi-notice-agree-button, #didomi-notice-learn-more-button', { timeout: 10000 })
        if (cookieButton) {
            await this.randomDelay(2000, 4000)
            
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
            await this.randomDelay(2000, 4000)
        }
      } catch (e: any) {
        if (e?.name !== 'TimeoutError') {
          console.log('Cookie banner error:', e)
        }
        await this.randomDelay(1000, 2000)
      }
      
      await this.checkForBotDetection(page)
      
      await this.randomDelay(2000, 4000)

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

          await this.takeScreenshot(page, `listings-not-found-${searchName || 'unknown'}`, {
            url: searchUrl,
            pageUrl: page.url(),
            pageTitle: await page.title().catch(() => 'unknown'),
            error: 'Could not find listings container',
          })
          
          throw new Error('Could not find listings container');
        }
      }

      console.log(`Using selector: ${listingsSelector}`)

      await this.randomDelay(2000, 4000)
      await this.autoScroll(page)
      await this.randomDelay(2000, 4000)

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

      await page.close()
      page = null

      return listings
        .filter((l) => l.lbcId && l.title)
        .filter((l) => !this.isCategoryExcluded(l.url))
        .filter((l) => l.priceCents >= env.MIN_LISTING_PRICE_EUR * 100)
    } catch (error: any) {
      console.error('Scraping error:', error)
      
      if (page && !page.isClosed()) {
        await this.takeScreenshot(page, `scraping-error-${searchName || 'unknown'}`, {
          url: searchUrl,
          error: error.message,
          stack: error.stack,
        })
      } else if (this.context && !this.context.browser()?.isConnected()) {
        console.error('Browser/Context closed, cannot take screenshot')
      } else {
        console.error('Page is closed, cannot take screenshot')
      }
      
      throw error
    }
  }

  private async isCategoryExcluded(url: string): Promise<boolean> {
    const parts = url.split('/').filter(Boolean)
    const categorySlug = parts.length >= 2 ? parts[parts.length - 2]?.split('.')[0] || '' : ''
    console.log(`Category slug: ${categorySlug}`)
    console.log(`Is excluded: ${CATEGORIES_SLUG_TO_EXCLUDE_FROM_LBC.includes(categorySlug)}`)
    return CATEGORIES_SLUG_TO_EXCLUDE_FROM_LBC.includes(categorySlug)
  }

  private async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private async checkForBotDetection(page: Page): Promise<void> {
    try {
      const datadomeChallenge = await page.$('[id*="datadome"], [class*="datadome"], [id*="challenge"], [class*="challenge"]')
      if (datadomeChallenge) {
        console.log('⚠️ DataDome challenge detected, waiting longer...')
        await this.randomDelay(5000, 10000)
        
        const screenshotUrl = await this.takeScreenshot(page, 'datadome-challenge-detected', {
          url: page.url(),
          detected: 'DataDome challenge element found',
        })
        
        if (screenshotUrl) {
          console.log(`📸 DataDome challenge screenshot: ${screenshotUrl}`)
        }
      }
      
      const pageContent = await page.content()
      if (pageContent.includes('datadome') || pageContent.includes('challenge') || pageContent.includes('blocked')) {
        console.log('⚠️ Possible DataDome blocking detected in page content')
        await this.randomDelay(3000, 6000)
      }
    } catch (e) {
      console.log('Error checking for bot detection:', e)
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
    let page: Page | null = null
    try {
      await this.initBrowser()
      page = await this.context!.newPage()

      try {
        await page.goto(listingUrl, { waitUntil: 'domcontentloaded' })
      } catch (gotoError: any) {
        await this.takeScreenshot(page, `details-goto-error`, {
          url: listingUrl,
          error: gotoError.message,
        })
        throw gotoError
      }

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
      page = null

      return {
        description,
        imageUrls: imageUrls as string[],
      }
    } catch (error: any) {
      console.error('Detail scraping error:', error)
      
      if (page && !page.isClosed()) {
        await this.takeScreenshot(page, `details-scraping-error`, {
          url: listingUrl,
          error: error.message,
        })
      }
      
      return { imageUrls: [] }
    }
  }

  private async initBrowser(): Promise<void> {
    if (!this.browser) {
      this.browser = await createBrowser()
      
      const proxyConfig = this.proxyManager && this.proxyManager.hasProxies()
        ? this.proxyManager.getProxyForPlaywright(this.proxyManager.getNextProxy()!)
        : undefined
      
      if (proxyConfig) {
        console.log(`🔄 [LeBonCoin Scraper] Using proxy: ${proxyConfig.server}`)
      }
      
      this.context = await createBrowserContext(this.browser, proxyConfig)
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

  private async takeScreenshot(
    page: Page | null,
    label: string,
    metadata?: Record<string, any>
  ): Promise<string | null> {
    if (!page || page.isClosed()) {
      console.log(`⚠️ Cannot take screenshot for ${label}: page is closed`)
      return null
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = `${sanitizedLabel}-${timestamp}`
      
      console.log(`📸 Taking screenshot for ${label}...`)
      const screenshot = await page.screenshot({ fullPage: true, type: 'png' })
      
      const screenshotBase64 = screenshot.toString('base64')
      const screenshotDataUri = `data:image/png;base64,${screenshotBase64}`
      
      const uploadOptions: any = {
        folder: 'lbc-bot/screenshots',
        public_id: filename,
        overwrite: true,
        resource_type: 'image',
      }

      if (metadata) {
        uploadOptions.context = {
          metadata: JSON.stringify(metadata),
        }
      }

      console.log(`☁️ Uploading screenshot to Cloudinary...`)
      const uploadResult = await cloudinary.uploader.upload(screenshotDataUri, uploadOptions)
      const screenshotUrl = uploadResult.secure_url
      
      console.log(`✅ Screenshot uploaded successfully!`)
      console.log(`   📸 URL: ${screenshotUrl}`)
      console.log(`   📁 Folder: lbc-bot/screenshots`)
      console.log(`   🏷️  Label: ${label}`)
      if (metadata) {
        console.log(`   📋 Metadata:`, JSON.stringify(metadata, null, 2))
      }
      
      return screenshotUrl
    } catch (screenshotError: any) {
      console.error(`❌ Failed to take/upload screenshot for ${label}:`, screenshotError.message)
      if (screenshotError.stack) {
        console.error(`   Stack:`, screenshotError.stack)
      }
      return null
    }
  }
}

