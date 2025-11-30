import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';
import { IReferenceScraper } from '../IReferenceScraper';
import { Browser, Page } from 'playwright-core';
import { createStealthBrowser, createStealthBrowserContext, randomDelay } from '../../playwright-config';

export class FirstDibsScraper implements IReferenceScraper {
  sourceName = '1stdibs';

  async scrape(searchQuery: string): Promise<ReferenceProduct[]> {
    return this.searchByQuery(searchQuery);
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

  private async searchByQuery(searchQuery: string): Promise<ReferenceProduct[]> {
    console.log(`Starting 1stdibs search for query: "${searchQuery}"...`);
    const browser = await createStealthBrowser();
    const context = await createStealthBrowserContext(browser);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];
    
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const resourceType = route.request().resourceType();
      
      if (resourceType === 'image' && (url.includes('tracking') || url.includes('analytics') || url.includes('pixel'))) {
        route.abort();
        return;
      }
      
      if (url.includes('bot-detection') || url.includes('datadome') || url.includes('cloudflare')) {
        route.abort();
        return;
      }
      
      route.continue();
    });

    const corsErrorCount = new Map<string, number>();
    const botDetectionKeywords = ['bot', 'automation', 'captcha', 'blocked', 'suspicious', 'robot', 'crawler', 'scraper', 'webdriver', 'headless'];

    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      
      const isCorsError = text.includes('CORS policy') || text.includes('ERR_FAILED');
      const isBotDetection = botDetectionKeywords.some(keyword => 
        text.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isCorsError) {
        const key = text.substring(0, 100);
        corsErrorCount.set(key, (corsErrorCount.get(key) || 0) + 1);
        return;
      }
      
      if (isBotDetection || type === 'error' || type === 'warning') {
        console.log(`[Browser Console ${type}] ${text}`);
      } else if (type === 'log' && text.length > 0) {
        console.log(`[Browser Console ${type}] ${text}`);
      }
    });

    page.on('pageerror', (error) => {
      const errorText = error.message.toLowerCase();
      const isBotDetection = botDetectionKeywords.some(keyword => 
        errorText.includes(keyword.toLowerCase())
      );
      
      if (isBotDetection || !errorText.includes('cors')) {
        console.log(`[Browser Page Error] ${error.message}`);
      }
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      const failure = request.failure();
      if (failure && !url.includes('1stdibscdn.com')) {
        console.log(`[Network Request Failed] ${request.method()} ${url} - ${failure.errorText}`);
      }
    });

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.includes('1stdibscdn.com')) {
        console.log(`[Network Response ${status}] ${url}`);
      }
    });

    try {
      const searchUrl = `https://www.1stdibs.com/fr/search/furniture/?q=${encodeURIComponent(searchQuery)}`;
      console.log(`Navigating to ${searchUrl}...`);
      
      await page.goto(searchUrl, { waitUntil: 'load', timeout: 60000 });
      
      await page.waitForTimeout(randomDelay(2000, 4000));
      
      await page.mouse.move(100, 100);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollBy(0, 200));
      await page.waitForTimeout(randomDelay(1000, 2000));
      
      const jsLoaded = await page.evaluate(() => {
        return typeof window !== 'undefined' && 
               typeof document !== 'undefined' &&
               document.readyState === 'complete';
      });
      
      console.log(`[Info] JavaScript loaded: ${jsLoaded ? 'OK' : 'Problème'}`);
      
      const scriptsLoaded = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const loadedScripts = scripts.filter(script => {
          try {
            return (script as HTMLScriptElement).src && 
                   !(script as HTMLScriptElement).src.includes('data:');
          } catch {
            return false;
          }
        });
        return {
          total: scripts.length,
          withSrc: loadedScripts.length,
        };
      });
      
      console.log(`[Info] Scripts: ${scriptsLoaded.total} total, ${scriptsLoaded.withSrc} avec src`);
      
      const pageContent = await page.content();
      const hasContent = pageContent.length > 50000;
      console.log(`[Info] Page loaded: ${hasContent ? 'OK' : 'Possible problème'} (${Math.round(pageContent.length / 1000)}KB)`);
      
      await page.waitForTimeout(2000);

      const botDetectionMessages = await page.evaluate(() => {
        const messages: string[] = [];
        const keywords = [
          /\bbot\b/i,
          /\bblocked\b/i,
          /\bcaptcha\b/i,
          /\bautomation\b/i,
          /\brobot\b/i,
          /\bcrawler\b/i,
          /\bsuspicious\b/i,
          /\baccess denied\b/i,
          /\bforbidden\b/i,
          /\bunauthorized\b/i,
        ];
        
        const bodyText = document.body?.textContent || '';
        const hasSuspiciousContent = keywords.some(regex => regex.test(bodyText));
        
        if (hasSuspiciousContent) {
          const allElements = Array.from(document.querySelectorAll('h1, h2, h3, p, div[class*="error"], div[class*="blocked"], div[class*="captcha"]'));
          const suspiciousElements = allElements.filter(el => {
            const text = el.textContent || '';
            const hasKeyword = keywords.some(regex => regex.test(text));
            const style = window.getComputedStyle(el);
            const hasVisibleText = style.display !== 'none' && 
                                  style.visibility !== 'hidden' &&
                                  style.opacity !== '0';
            return hasKeyword && hasVisibleText;
          });
          
          suspiciousElements.forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length < 300 && text.length > 5) {
              const isLikelyBotMessage = keywords.some(regex => {
                const match = text.match(regex);
                return match && match[0].length > 3;
              });
              if (isLikelyBotMessage) {
                messages.push(text);
              }
            }
          });
        }
        
        return [...new Set(messages)].slice(0, 5);
      });

      if (botDetectionMessages.length > 0) {
        console.log(`[⚠️ Bot Detection Possible] Messages trouvés dans le DOM:`, botDetectionMessages);
      }

      try {
        const acceptButton = page.getByRole('button', { name: /accept|accepter|ok|i agree/i });
        if (await acceptButton.isVisible({ timeout: 1000 })) {
            await acceptButton.click();
            await page.waitForTimeout(1000);
        }
      } catch (e) {
      }

      if (corsErrorCount.size > 0) {
        console.log(`[Info] ${corsErrorCount.size} types d'erreurs CORS détectées (masquées pour la lisibilité)`);
      }

      console.log('Waiting for product cards...');
      
      const waitForContent = async () => {
        try {
          await page.waitForFunction(
            () => {
              const container = document.querySelector('[data-tn="search-results-container"]');
              if (container) return true;
              
              const anyResults = document.querySelector('[data-tn*="item"], [data-tn*="result"], [data-tn*="search"]');
              return anyResults !== null;
            },
            { timeout: 15000 }
          );
          return true;
        } catch {
          return false;
        }
      };
      
      const contentLoaded = await waitForContent();
      
      if (!contentLoaded) {
        console.log('[Warning] Le contenu ne semble pas s\'être chargé, vérification du DOM...');
        
        const jsExecutionCheck = await page.evaluate(() => {
          return {
            windowDefined: typeof window !== 'undefined',
            documentReady: document.readyState,
            hasReact: !!(window as any).React || !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__,
            hasJQuery: !!(window as any).jQuery || !!(window as any).$,
            scriptsInDOM: document.querySelectorAll('script').length,
            bodyChildren: document.body?.children.length || 0,
          };
        });
        
        console.log('[Diagnostic JS]', JSON.stringify(jsExecutionCheck, null, 2));
      }
      
      try {
        await page.waitForSelector('[data-tn="search-results-container"]', { timeout: 5000 });
      } catch (e) {
        const domDiagnostic = await page.evaluate(() => {
          const diagnostics: Record<string, any> = {};
          
          diagnostics.url = window.location.href;
          diagnostics.title = document.title;
          diagnostics.bodyTextLength = document.body?.textContent?.length || 0;
          
          const possibleSelectors = [
            '[data-tn="search-results-container"]',
            '[data-tn*="search"]',
            '[data-tn*="result"]',
            '[data-tn*="item"]',
            '.search-results',
            '[class*="search"]',
            '[class*="result"]',
            '[id*="search"]',
            '[id*="result"]',
          ];
          
          diagnostics.foundSelectors = possibleSelectors
            .map(selector => {
              const elements = document.querySelectorAll(selector);
              return {
                selector,
                count: elements.length,
                firstElement: elements.length > 0 ? {
                  tagName: elements[0].tagName,
                  className: elements[0].className,
                  id: elements[0].id,
                  dataAttributes: Array.from(elements[0].attributes)
                    .filter(attr => attr.name.startsWith('data-'))
                    .map(attr => `${attr.name}="${attr.value}"`),
                } : null,
              };
            })
            .filter(item => item.count > 0);
          
          const allDataTn = Array.from(document.querySelectorAll('[data-tn]'))
            .map(el => el.getAttribute('data-tn'))
            .filter(Boolean);
          diagnostics.allDataTnAttributes = [...new Set(allDataTn)].slice(0, 20);
          
          const mainContent = document.querySelector('main, [role="main"], #main, .main-content, [class*="main"]');
          if (mainContent) {
            diagnostics.mainContent = {
              tagName: mainContent.tagName,
              className: mainContent.className,
              textPreview: mainContent.textContent?.substring(0, 200) || '',
            };
          }
          
          return diagnostics;
        });
        
        console.log('[Diagnostic DOM]', JSON.stringify(domDiagnostic, null, 2));
        console.log('No results found on 1stdibs.');
        return [];
      }
      
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(2000);
      
      const productsFromList = await page.evaluate(() => {
        const container = document.querySelector('[data-tn="search-results-container"]');
        if (!container) return [];
        
        const items = Array.from(container.querySelectorAll('[data-tn="item-tile-wrapper"]'));
        const results: any[] = [];
        
        for (const item of items.slice(0, 10)) {
          try {
            const linkEl = item.querySelector('a[data-tn="item-tile-title-anchor"]') as HTMLAnchorElement;
            if (!linkEl || !linkEl.href) continue;
            
            const url = linkEl.href;
            const titleEl = item.querySelector('h2._517e4fae, [data-tn*="title"], h2, h3');
            const title = titleEl?.textContent?.trim() || '';
            
            if (!title) continue;
            
            const priceEl = item.querySelector('[data-tn="price"], [data-tn*="price"]');
            const priceText = priceEl?.textContent?.trim() || '';
            
            if (!priceText) continue;
            
            const priceMatch = priceText.match(/[\d,.\s]+/);
            const price = priceMatch ? parseFloat(priceMatch[0].replace(/[^\d.]/g, '').replace(',', '.')) : undefined;
            
            if (!price || price <= 0 || isNaN(price)) continue;
            
            const currency = priceText.includes('€') || priceText.includes('EUR') ? 'EUR' :
                           priceText.includes('$') || priceText.includes('USD') ? 'USD' :
                           priceText.includes('£') || priceText.includes('GBP') ? 'GBP' : 'USD';
            
            const imageUrls: string[] = [];
            const imageEls = item.querySelectorAll('img[data-tn="product-image"], img[data-tn*="image"], img');
            imageEls.forEach((img) => {
              const src = img.getAttribute('data-src') || 
                          img.getAttribute('data-lazy-src') || 
                          img.getAttribute('src') || 
                          (img as HTMLImageElement).src;
              if (src && !src.includes('icon') && !src.includes('logo') && !src.includes('placeholder') && src.startsWith('http')) {
                imageUrls.push(src);
              }
            });
            
            const allText = item.textContent || '';
            
            let designer: string | undefined;
            let period: string | undefined;
            let material: string | undefined;
            let style: string | undefined;
            
            const designerMatch = allText.match(/(?:Maker|Designer|Brand|Fabricant)[:\s]+([^\n,]+)/i);
            if (designerMatch) designer = designerMatch[1].trim();
            
            const periodMatch = allText.match(/(?:Période|Period|Date de fabrication)[:\s]+([^\n,]+)/i);
            if (periodMatch) period = periodMatch[1].trim();
            
            const materialMatch = allText.match(/(?:Matériaux|Materials|Material)[:\s]+([^\n,]+)/i);
            if (materialMatch) material = materialMatch[1].trim();
            
            const styleMatch = allText.match(/(?:Style)[:\s]+([^\n,]+)/i);
            if (styleMatch) style = styleMatch[1].trim();
            
            const specElements = item.querySelectorAll('[data-tn*="spec"], [class*="spec"], [class*="detail"]');
            specElements.forEach(spec => {
              const text = spec.textContent?.toLowerCase() || '';
              const value = spec.textContent?.trim() || '';
              
              if (text.includes('maker') || text.includes('designer') || text.includes('fabricant')) {
                designer = value.split(/[:\n]/)[1]?.trim() || designer;
              }
              if (text.includes('période') || text.includes('period')) {
                period = value.split(/[:\n]/)[1]?.trim() || period;
              }
              if (text.includes('matériaux') || text.includes('materials') || text.includes('material')) {
                material = value.split(/[:\n]/)[1]?.trim() || material;
              }
              if (text.includes('style')) {
                style = value.split(/[:\n]/)[1]?.trim() || style;
              }
            });
            
            results.push({
              title,
              price,
              currency,
              url,
              imageUrls: [...new Set(imageUrls)].slice(0, 5),
              designer,
              period,
              material,
              style,
            });
          } catch (e) {
            console.error('Error parsing product card from list:', e);
          }
        }
        
        return results;
      });

      console.log(`Found ${productsFromList.length} products from list.`);

      for (const product of productsFromList.slice(0, 10)) {
        if (product.title && product.price) {
          results.push({
            title: product.title,
            price: product.price,
            currency: product.currency,
            source: '1stdibs',
            url: product.url,
            imageUrls: product.imageUrls || [],
            designer: product.designer,
            period: product.period,
            material: product.material,
            style: product.style,
          });
        }
      }

    } catch (error) {
      console.error('Error during 1stdibs search:', error);
    } finally {
      await browser.close();
    }

    return results;
  }

  private async scrapeProductPageForReference(page: Page, url: string): Promise<ReferenceProduct | null> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      const title = await page.locator('[data-tn="pdp-main-title"]').innerText({ timeout: 5000 }).catch(() => '');
      if (!title) return null;

      await page.waitForSelector('[data-tn="price-amount"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      
      const priceText = await page.locator('[data-tn="price-amount"]').innerText({ timeout: 5000 }).catch(() => '');
      const price = this.parsePrice(priceText);
      const currency = this.parseCurrency(priceText) || 'EUR';
      
      if (!price) return null;

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
        return [...new Set(images)].slice(0, 5);
      });

      const specs: Record<string, string> = await page.evaluate(() => {
        const data: Record<string, string> = {};
        const specTitles = Array.from(document.querySelectorAll('[data-tn="pdp-spec-title"]'));
        specTitles.forEach(titleElement => {
          const key = titleElement.textContent?.trim().replace(':', '') || '';
          const parent = titleElement.closest('li');
          if (parent) {
            const valueElement = parent.querySelector('[data-tn^="pdp-spec-detail-"]');
            if (valueElement) {
              const value = valueElement.textContent?.trim() || '';
              if (key && value) {
                data[key] = value;
              }
            }
          }
        });
        return data;
      });

      const designer = specs['Maker'] || specs['Designer'] || specs['Brand'] || specs['Fabricant'] || undefined;
      const period = specs['Période'] || specs['Period'] || specs['Date de fabrication'] || undefined;
      const material = specs['Matériaux et techniques'] || specs['Materials'] || specs['Material'] || undefined;
      const style = specs['Style'] || undefined;

      return {
        title,
        price,
        currency,
        source: '1stdibs',
        url,
        imageUrls,
        designer,
        period,
        material,
        style,
      };
    } catch (error) {
      return null;
    }
  }
}

