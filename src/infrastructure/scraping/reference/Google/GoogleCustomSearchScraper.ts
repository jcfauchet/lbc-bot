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
    
    const delay = this.bypass.getRandomDelayBeforeRequest();
    console.log(`⏳ Waiting ${Math.round(delay)}ms before starting scrape...`);
    await this.bypass.delay(delay);
    
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
        if (attempt >= 3) {
          const extraDelay = Math.floor(Math.random() * 10000) + 5000;
          console.log(`🛑 Multiple failures detected, waiting ${extraDelay}ms before next attempt...`);
          return this.bypass.delay(extraDelay);
        }
      }
    );
  }

  private async performScrape(imageUrl: string, attemptWithoutProxy: boolean = false): Promise<ReferenceProduct[]> {
    const browser = await createStealthBrowser();
    
    let proxyConfig = undefined;
    let proxyIndex = -1;
    let currentProxy = null;
    
    if (!attemptWithoutProxy && this.proxyManager && this.proxyManager.hasProxies()) {
      currentProxy = this.proxyManager.getNextProxy();
      if (currentProxy) {
        proxyConfig = this.proxyManager.getProxyForPlaywright(currentProxy);
        proxyIndex = (this.proxyManager as any).proxies.indexOf(currentProxy);
        console.log(`🔄 [Google Images] Using proxy ${proxyIndex + 1}/${this.proxyManager.getProxyCount()}: ${currentProxy.host}:${currentProxy.port}`);
      }
    } else if (attemptWithoutProxy) {
      console.log(`⚠️ [Google Images] Retrying without proxy after proxy failures...`);
    }
    
    const userAgent = this.bypass.getRandomBrowserUserAgent();
    const browserHeaders = this.bypass.generateBrowserHeaders(userAgent);
    
    console.log(`🔍 [Google Images] Using User-Agent: ${userAgent.substring(0, 50)}...`);
    
    const context = await this.createBrowserContextWithHeaders(browser, userAgent, browserHeaders, proxyConfig);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      console.log('Navigating to Google Images...');
      
      await page.setExtraHTTPHeaders({
        ...browserHeaders,
        'Referer': 'https://www.google.com/',
        'Origin': 'https://www.google.com',
      });
      
      try {
        await page.goto('https://images.google.com/', { 
          waitUntil: 'domcontentloaded', 
          timeout: 90000 
        });
      } catch (gotoError: any) {
        const errorMessage = gotoError?.message || '';
        const isProxyError = errorMessage.includes('ERR_TUNNEL_CONNECTION_FAILED') || 
                            errorMessage.includes('ERR_TIMED_OUT') ||
                            errorMessage.includes('ERR_PROXY_CONNECTION_FAILED');
        
        if (isProxyError && currentProxy && !attemptWithoutProxy) {
          console.log(`⚠️ Proxy error detected, trying without proxy...`);
          
          if (proxyIndex >= 0 && this.proxyManager) {
            this.proxyManager.recordProxyFailure(proxyIndex);
          }
          
          await page.close();
          await context.close();
          await browser.close();
          
          return await this.performScrape(imageUrl, true);
        }
        
        throw gotoError;
      }
      
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
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      } catch (e) {
        console.log('⚠️ networkidle timeout, continuing anyway...');
      }
      await this.simulateHumanBehavior(page);
      await this.bypass.delay(3000 + Math.random() * 2000);

      console.log('Looking for Shopping tab...');
      try {
        const shoppingTab = page.getByRole('button', { name: /shopping|produits/i }).first();
        const shoppingLink = page.getByRole('link', { name: /shopping|produits/i }).first();
        
        if (await shoppingTab.isVisible()) {
            await shoppingTab.click();
            try {
              await page.waitForLoadState('networkidle', { timeout: 15000 });
            } catch (e) {
              console.log('⚠️ networkidle timeout after shopping tab click, continuing...');
            }
        } else if (await shoppingLink.isVisible()) {
            await shoppingLink.click();
            try {
              await page.waitForLoadState('networkidle', { timeout: 15000 });
            } catch (e) {
              console.log('⚠️ networkidle timeout after shopping link click, continuing...');
            }
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
      
      if (proxyIndex >= 0 && this.proxyManager && currentProxy) {
        this.proxyManager.recordProxySuccess(proxyIndex);
      }
      
      return uniqueResults.slice(0, 10);

    } catch (error) {
      console.error('Error during Google Image scrape:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isProxyError = errorMessage.includes('ERR_TUNNEL_CONNECTION_FAILED') || 
                          errorMessage.includes('ERR_TIMED_OUT') ||
                          errorMessage.includes('ERR_PROXY_CONNECTION_FAILED');
      
      if (isProxyError && currentProxy && !attemptWithoutProxy) {
        if (proxyIndex >= 0 && this.proxyManager) {
          this.proxyManager.recordProxyFailure(proxyIndex);
        }
        
        try {
          await page.close();
        } catch (e) {}
        try {
          await context.close();
        } catch (e) {}
        try {
          await browser.close();
        } catch (e) {}
        
        console.log(`⚠️ Proxy failed, retrying without proxy...`);
        return await this.performScrape(imageUrl, true);
      }
      
      if (proxyIndex >= 0 && this.proxyManager && currentProxy && !isProxyError) {
        this.proxyManager.recordProxyFailure(proxyIndex);
      }
      
      if (error instanceof Error && (
        error.message.includes('blocking') || 
        error.message.includes('CAPTCHA') ||
        error.message.includes('unusual traffic') ||
        error.message.includes('Datadome')
      )) {
        throw error;
      }
      
      if (isProxyError && attemptWithoutProxy) {
        throw new Error('All proxies failed and direct connection also failed');
      }
      
      throw error;
    } finally {
      try {
        await page.close();
      } catch (e) {}
      try {
        await context.close();
      } catch (e) {}
      try {
        await browser.close();
      } catch (e) {}
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

  private async createBrowserContextWithHeaders(
    browser: any,
    userAgent: string,
    browserHeaders: Record<string, string>,
    proxyConfig?: { server: string; username?: string; password?: string }
  ): Promise<any> {
    const contextOptions: any = {
      userAgent,
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      permissions: [],
      colorScheme: 'light',
      extraHTTPHeaders: {
        ...browserHeaders,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
      },
    };

    if (proxyConfig) {
      contextOptions.proxy = proxyConfig;
    }
    
    const context = await browser.newContext(contextOptions);

    await context.addInitScript(() => {
      const plugins: any[] = [];
      for (let i = 0; i < 5; i++) {
        plugins.push({
          name: `Plugin ${i}`,
          description: `Plugin ${i} Description`,
          filename: `plugin${i}.dll`,
          length: 1,
        });
      }
      const languages = ['fr-FR', 'fr', 'en-US', 'en'];

      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });
      
      delete (navigator as any).__proto__.webdriver;
      
      Object.defineProperty(window, 'navigator', {
        value: navigator,
        writable: false,
        configurable: false,
      });
      
      if ((window as any).__playwright) delete (window as any).__playwright;
      if ((window as any).__pw) delete (window as any).__pw;
      if ((document as any).$cdc) delete (document as any).$cdc;
      if ((document as any).__$webdriver) delete (document as any).__$webdriver;
      
      Object.defineProperty(navigator, 'plugins', {
        get: () => plugins,
      });
      
      Object.defineProperty(navigator, 'languages', {
        get: () => languages,
      });
      
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
      };
      
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({
          query: (permissionDesc: PermissionDescriptor) => Promise.resolve({ state: 'granted' } as PermissionStatus),
        }),
      });
      
      Object.defineProperty(navigator, 'platform', {
        get: () => 'MacIntel',
      });
      
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });
      
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
      
      if ((navigator as any).getBattery) {
        (navigator as any).getBattery = () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
        });
      }
      
      Object.defineProperty(navigator, 'toString', {
        value: () => '[object Navigator]',
      });
      
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }),
      });
      
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
      });
      
      try {
          delete (window as any).navigator.__proto__.webdriver;
      } catch (e) {}
      
      const originalQuery = window.document.querySelector;
      window.document.querySelector = function(selector: string) {
        if (selector === 'head > script[src*="selenium"]') {
          return null;
        }
        return originalQuery.call(document, selector);
      };
      
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 0,
      });
      
      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
      });
      
      Object.defineProperty(navigator, 'vendorSub', {
        get: () => '',
      });
    });

    return context;
  }
}
