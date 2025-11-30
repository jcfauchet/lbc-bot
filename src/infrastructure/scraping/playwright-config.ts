import chromium from '@sparticuz/chromium'
import playwright, { chromium as chromiumOrigin, Browser, BrowserContext } from 'playwright-core'

export const defaultTimeout = 120_000

export async function createBrowserForVercel(): Promise<Browser> {
  if (process.env.NODE_ENV !== 'development') {
    const chromiumArgs = [
      ...chromium.args,
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--start-maximized',
    ]
    
    return await playwright.chromium.launch({
      headless: true,
      timeout: defaultTimeout,
      executablePath: await chromium.executablePath(),
      args: chromiumArgs,
    })
  }
  
  return await chromiumOrigin.launch({
    headless: false,
    timeout: defaultTimeout,
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
  })
}

export async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  // Use a more recent Chrome user agent
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    permissions: [],
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
  });

  await context.addInitScript(() => {
    // Remove webdriver flag completely
    delete (navigator as any).webdriver;
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    
    // Override the plugins property to make it look like a real browser
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Set languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['fr-FR', 'fr', 'en-US', 'en'],
    });
    
    // Add chrome object with more properties
    (window as any).chrome = {
      runtime: {},
      loadTimes: function() {},
      csi: function() {},
      app: {},
    };
    
    // Override permissions API
    Object.defineProperty(navigator, 'permissions', {
      get: () => ({
        query: () => Promise.resolve({ state: 'granted' } as PermissionStatus),
      }),
    });
    
    // Override platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    });
    
    // Add hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });
    
    // Add deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });
    
    // Override getBattery if it exists
    if ((navigator as any).getBattery) {
      (navigator as any).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
      });
    }
    
    // Override toString methods to hide automation
    Object.defineProperty(navigator, 'toString', {
      value: () => '[object Navigator]',
    });
    
    // Add connection property
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false,
      }),
    });
    
    // Override Notification permission
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
    });
    
    // Hide automation in window object
    Object.defineProperty(window, 'navigator', {
      value: navigator,
    });
  });

  return context;
}

