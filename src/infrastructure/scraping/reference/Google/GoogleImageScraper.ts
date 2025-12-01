import { ReferenceProduct } from '@/domain/services/IPriceEstimationService';
import { Page } from 'playwright-core';
import { IReferenceScraper } from '../IReferenceScraper';
import { createStealthBrowser, createStealthBrowserContext } from '../../playwright-config';
import { sleep } from 'openai/core.mjs';

export class GoogleImageScraper implements IReferenceScraper {
  private readonly baseUrl = 'https://lens.google.com';

  async scrape(imageUrl: string): Promise<ReferenceProduct[]> {
    console.log(`Starting Google Image scrape for image: "${imageUrl}"...`);
    // Use stealth browser to avoid detection
    const browser = await createStealthBrowser();
    const context = await createStealthBrowserContext(browser);
    const page = await context.newPage();
    const results: ReferenceProduct[] = [];

    try {
      // Navigate to Google Images
      console.log('Navigating to Google Images...');
      await page.goto('https://images.google.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Handle Cookie Consent
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

      // Check for CAPTCHA
      const captchaText = await page.getByText(/Nos systèmes ont détecté un trafic exceptionnel|Our systems have detected unusual traffic/i).first();
      if (await captchaText.isVisible()) {
          console.log('🔴 CAPTCHA DETECTED! Please solve it manually in the browser window.');
          console.log('Waiting for CAPTCHA to be solved (checking every 2 seconds)...');
          
          // Wait until the CAPTCHA text is no longer visible, with a long timeout
          await page.waitForFunction(() => {
              const text = document.body.innerText;
              return !text.includes('Nos systèmes ont détecté un trafic exceptionnel') && 
                     !text.includes('Our systems have detected unusual traffic');
          }, null, { timeout: 300000 }); // 5 minutes timeout
          
          console.log('✅ CAPTCHA solved! Resuming scrape...');
          await page.waitForTimeout(2000);
      }

      // Click "Search by image" (Camera icon)
      console.log('Clicking "Search by image"...');
      const cameraButton = page.getByRole('button', { name: /Recherche.*par image|Search.*by image/i }).first();
      if (await cameraButton.isVisible()) {
          await cameraButton.click();
      } else {
          // Fallback selectors
          await page.click('div[aria-label="Recherche par image"], div[aria-label="Search by image"]');
      }
      
      await page.waitForTimeout(1000);

      // Input Image URL
      console.log('Inputting image URL...');
      // Try to find the input field. It usually appears in a modal or popover.
      // Often has placeholder "Paste image link" or similar.
      const urlInput = page.getByPlaceholder("Coller le lien de l'image").first();

      
      if (await urlInput.isVisible()) {
          await urlInput.fill(imageUrl);
          await urlInput.press('Enter');
      } else {
          // Sometimes there is a "Paste image link" button first
          const pasteLinkButton = page.getByRole('button', { name: /Coller.*lien|Paste.*link/i });
          if (await pasteLinkButton.isVisible()) {
              await pasteLinkButton.click();
              await page.waitForTimeout(500);
              await page.getByPlaceholder(/Collez.*lien|Paste.*link/i).fill(imageUrl);
              await page.keyboard.press('Enter');
          } else {
             // Try generic input if specific placeholder fails
             await page.fill('input[type="text"]', imageUrl);
             await page.keyboard.press('Enter');
          }
      }

      console.log('Waiting for results...');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000); // Extra wait for dynamic content

      // Click on "Shopping" or "Produits" tab if available
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

      // Scrape results
      results.push(...await page.evaluate(() => {
        // Try to find product cards in the grid
        // Google Lens results often have a grid of images.
        // We look for elements that have price information.
        
        const potentialProducts = Array.from(document.querySelectorAll('a'));
        
        return potentialProducts.map(link => {
            try {
                const text = link.innerText;
                const priceMatch = text.match(/[\d\s.,]+€/);
                
                if (!priceMatch) return null;
                
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

      // Deduplicate results based on URL
      const uniqueResults = results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
      
      console.log(`Current URL: ${page.url()}`);
      if (uniqueResults.length === 0) {
        console.log('No results found. Taking screenshot...');
        await page.screenshot({ path: 'google-lens-debug.png', fullPage: true });
        const content = await page.content();
        const fs = await import('fs');
        fs.writeFileSync('google-lens-debug.html', content);
      }

      console.log(`Found ${uniqueResults.length} products on Google Lens.`);
      return uniqueResults.slice(0, 10); // Limit to top 10

    } catch (error) {
      console.error('Error during Google Image scrape:', error);
      return [];
    } finally {
      await browser.close();
    }
  }
}
