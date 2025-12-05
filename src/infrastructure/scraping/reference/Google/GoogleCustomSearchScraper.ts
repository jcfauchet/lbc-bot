import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';
import { Page } from 'playwright-core';
import { createStealthBrowser, createStealthBrowserContext } from '../../playwright-config';
import { DataDomeBypass } from '@/infrastructure/api/DataDomeBypass';
import { ProxyManager } from '@/infrastructure/proxy/ProxyManager';
import { env } from '@/infrastructure/config/env';

export class GoogleCustomSearchScraper {
  private readonly baseUrl = 'https://lens.google.com';
  private readonly bypass = new DataDomeBypass();
  private readonly proxyManager: ProxyManager | null;

  constructor() {
    this.proxyManager = env.PROXY_ENABLED && env.PROXY_LIST.length > 0
      ? new ProxyManager(env.PROXY_LIST)
      : null;
  }

  async scrape(imageUrl: string): Promise<ReferenceProduct[]> {
    console.log(`Starting Google Image scrape for image: "${imageUrl}"...`);
    
    return await this.bypass.retryWithBackoff(
      async () => {
        return await this.performScrape(imageUrl);
      },
      5,
      (attempt, error) => {
        console.log(`🔄 Retry attempt ${attempt} for Google Lens scrape (error: ${error.message})`);
        if (this.bypass.shouldRotateUserAgent()) {
          console.log('🔄 Rotating user agent for Google Lens...');
        }
      }
    );
  }

  private async performScrape(imageUrl: string): Promise<ReferenceProduct[]> {
    const delay = this.bypass.getRandomDelayBeforeRequest();
    console.log(`⏳ Waiting ${Math.round(delay)}ms before starting scrape...`);
    await this.bypass.delay(delay);

    const browser = await createStealthBrowser();
    
    let proxyConfig = undefined;
    if (this.proxyManager && this.proxyManager.hasProxies()) {
      const proxy = this.proxyManager.getNextProxy();
      if (proxy) {
        proxyConfig = this.proxyManager.getProxyForPlaywright(proxy);
        console.log(`🔄 Using proxy: ${proxy.host}:${proxy.port}`);
      }
    }
    
    const context = await createStealthBrowserContext(browser, proxyConfig);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      console.log('Navigating to Google Images...');
      
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/',
        'Origin': 'https://www.google.com',
      });
      
      await page.goto('https://images.google.com/', { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
      });
      
      await this.simulateHumanBehavior(page);
      await this.bypass.delay(2000 + Math.random() * 2000);

      try {
        console.log('Checking for consent...');
        await page.waitForTimeout(2000);
        const consentSelectors = [
            'button[aria-label="Tout accepter"]',
            'button[aria-label="Accept all"]',
            'div[role="button"]:has-text("Tout accepter")',
            'div[role="button"]:has-text("Accept all")',
            'button:has-text("Tout accepter")',
            'button:has-text("Accept all")',
            'form[action*="consent"] button'
        ];

        for (const selector of consentSelectors) {
            if (await page.isVisible(selector)) {
                console.log(`Found consent button with selector: ${selector}`);
                await page.click(selector);
                await page.waitForLoadState('networkidle');
                break;
            }
        }
      } catch (e) {
        console.log('Consent handling error (might be already accepted):', e);
      }

      const pageContent = await page.content();
      const hasCaptcha = pageContent.includes('Nos systèmes ont détecté un trafic exceptionnel') || 
                        pageContent.includes('Our systems have detected unusual traffic') ||
                        pageContent.includes('captcha') ||
                        pageContent.includes('CAPTCHA');
      
      if (hasCaptcha) {
        try {
          const captchaText = await page.getByText(/Nos systèmes ont détecté un trafic exceptionnel|Our systems have detected unusual traffic|captcha|CAPTCHA/i).first();
          if (await captchaText.isVisible()) {
            console.log('🔴 CAPTCHA/BLOCKING DETECTED! Throwing error to trigger retry with new user agent...');
            throw new Error('Google Lens blocking detected - CAPTCHA or unusual traffic');
          }
        } catch (e) {
          if (hasCaptcha) {
            console.log('🔴 CAPTCHA/BLOCKING DETECTED in page content! Throwing error to trigger retry...');
            throw new Error('Google Lens blocking detected - CAPTCHA or unusual traffic');
          }
        }
      }
      
      const isBlocked = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('unusual traffic') || 
               bodyText.includes('trafic exceptionnel') ||
               bodyText.includes('verify you') ||
               bodyText.includes('vérifiez que vous');
      });
      
      if (isBlocked) {
        console.log('🔴 Blocking detected! Throwing error to trigger retry...');
        throw new Error('Google Lens blocking detected');
      }

      console.log('Clicking "Search by image"...');
      await this.simulateHumanBehavior(page);
      
      const cameraButton = page.getByRole('button', { name: /Recherche.*par image|Search.*by image/i }).first();
      if (await cameraButton.isVisible()) {
          await this.humanClick(page, cameraButton);
      } else {
          const selector = 'div[aria-label="Recherche par image"], div[aria-label="Search by image"]';
          await this.humanClick(page, selector);
      }
      
      await this.bypass.delay(1000 + Math.random() * 1000);

      console.log('Inputting image URL...');
      await this.simulateHumanBehavior(page);
      
      const urlInput = page.getByPlaceholder("Coller le lien de l'image").first();

      
      if (await urlInput.isVisible()) {
          await this.humanType(page, urlInput, imageUrl);
          await this.bypass.delay(500 + Math.random() * 500);
          await page.keyboard.press('Enter');
      } else {
          const pasteLinkButton = page.getByRole('button', { name: /Coller.*lien|Paste.*link/i });
          if (await pasteLinkButton.isVisible()) {
              await this.humanClick(page, pasteLinkButton);
              await this.bypass.delay(500 + Math.random() * 500);
              const input = page.getByPlaceholder(/Collez.*lien|Paste.*link/i);
              await this.humanType(page, input, imageUrl);
              await this.bypass.delay(300 + Math.random() * 300);
              await page.keyboard.press('Enter');
          } else {
             await this.humanType(page, 'input[type="text"]', imageUrl);
             await this.bypass.delay(300 + Math.random() * 300);
             await page.keyboard.press('Enter');
          }
      }

      console.log('Waiting for results...');
      await page.waitForLoadState('networkidle');
      await this.simulateHumanBehavior(page);
      await this.bypass.delay(3000 + Math.random() * 2000);

      console.log('Looking for Shopping tab...');
      try {
        const shoppingTab = page.getByRole('button', { name: /shopping|produits/i }).first();
        const shoppingLink = page.getByRole('link', { name: /shopping|produits/i }).first();
        
        if (await shoppingTab.isVisible()) {
            await shoppingTab.click();
            await page.waitForLoadState('networkidle');
        } else if (await shoppingLink.isVisible()) {
            await shoppingLink.click();
            await page.waitForLoadState('networkidle');
        } else {
            console.log('Shopping tab not found, checking if we are already on it or if results are mixed.');
        }
      } catch (e) {
        console.log('Error clicking Shopping tab:', e);
      }

      results.push(...await page.evaluate(() => {
        const potentialProducts = Array.from(document.querySelectorAll('a'));
        
        return potentialProducts.map(link => {
            try {
                const text = link.innerText;
                const priceMatch = text.match(/[\d\s.,]+€/);

                const isLeboncoin = text.includes('Leboncoin');
                
                if (!priceMatch || isLeboncoin) return null;
                
                const priceText = priceMatch[0];
                const cleanPrice = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace(',', '.'));
                
                if (isNaN(cleanPrice)) return null;

                const title = text.replace(priceText, '').trim().split('\n')[0];
                if (!title || title.length < 5) return null;

                const url = link.href;
                const img = link.querySelector('img');
                const imageUrl = img?.src || '';

                return {
                    title,
                    price: cleanPrice,
                    currency: 'EUR',
                    source: 'Google Lens',
                    url,
                    imageUrls: imageUrl ? [imageUrl] : [],
                };
            } catch (e) {
                return null;
            }
        }).filter(item => item !== null);
      }));

      const uniqueResults = results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
      
      console.log(`Current URL: ${page.url()}`);
      if (uniqueResults.length === 0) {
        console.log('No results found.');
      }

      console.log(`Found ${uniqueResults.length} products on Google Lens.`);
      return uniqueResults.slice(0, 10);

    } catch (error) {
      console.error('Error during Google Image scrape:', error);
      if (error instanceof Error && (
        error.message.includes('blocking') || 
        error.message.includes('CAPTCHA') ||
        error.message.includes('unusual traffic') ||
        error.message.includes('Datadome')
      )) {
        throw error;
      }
      return [];
    } finally {
      await browser.close();
    }
  }

  private async simulateHumanBehavior(page: Page): Promise<void> {
    try {
      const viewport = page.viewportSize();
      if (viewport) {
        const x = Math.random() * viewport.width;
        const y = Math.random() * viewport.height;
        
        await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 3 });
        await this.bypass.delay(100 + Math.random() * 200);
        
        if (Math.random() > 0.7) {
          await page.mouse.wheel(0, Math.random() * 300 - 150);
          await this.bypass.delay(200 + Math.random() * 300);
        }
      }
    } catch (e) {
    }
  }

  private async humanClick(page: Page, element: any): Promise<void> {
    try {
      if (typeof element === 'string') {
        const box = await page.locator(element).boundingBox();
        if (box) {
          const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
          const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
          await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 3) + 2 });
          await this.bypass.delay(100 + Math.random() * 150);
          await page.mouse.click(x, y, { delay: 50 + Math.random() * 100 });
        } else {
          await page.click(element);
        }
      } else {
        const box = await element.boundingBox();
        if (box) {
          const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
          const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
          await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 3) + 2 });
          await this.bypass.delay(100 + Math.random() * 150);
          await page.mouse.click(x, y, { delay: 50 + Math.random() * 100 });
        } else {
          await element.click();
        }
      }
    } catch (e) {
      if (typeof element === 'string') {
        await page.click(element);
      } else {
        await element.click();
      }
    }
  }

  private async humanType(page: Page, element: any, text: string): Promise<void> {
    try {
      if (typeof element === 'string') {
        await page.click(element);
      } else {
        await element.click();
      }
      
      await this.bypass.delay(200 + Math.random() * 300);
      
      for (const char of text) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
        if (Math.random() > 0.95) {
          await this.bypass.delay(100 + Math.random() * 200);
        }
      }
    } catch (e) {
      if (typeof element === 'string') {
        await page.fill(element, text);
      } else {
        await element.fill(text);
      }
    }
  }
}
