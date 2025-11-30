import chromium from '@sparticuz/chromium'
import playwright, { chromium as chromiumOrigin, Browser, BrowserContext } from 'playwright-core'

export const defaultTimeout = 120_000

export async function createBrowserForVercel(): Promise<Browser> {
  if (process.env.NODE_ENV !== 'development') {
    return await playwright.chromium.launch({
      headless: true,
      timeout: defaultTimeout,
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    })
  }
  
  return await chromiumOrigin.launch({
    headless: false,
    timeout: defaultTimeout,
  })
}

export async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    permissions: [],
    extraHTTPHeaders: {
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    Object.defineProperty(navigator, 'languages', {
      get: () => ['fr-FR', 'fr', 'en-US', 'en'],
    });
    
    (window as any).chrome = {
      runtime: {},
    };
    
    Object.defineProperty(navigator, 'permissions', {
      get: () => ({
        query: () => Promise.resolve({ state: 'granted' }),
      }),
    });
  });

  return context;
}

