import chromium from '@sparticuz/chromium'
import playwright, { chromium as chromiumOrigin, Browser, BrowserContext } from 'playwright-core'

export const defaultTimeout = 120_000

export async function createBrowser(): Promise<Browser> {
  
  if (process.env.NODE_ENV === 'production') {
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
      '--disable-gpu',
      '--disable-extensions',
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
  const headersList = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept-Language': 'en-GB,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
    }
  ];

  // const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const userAgent = headersList[Math.floor(Math.random() * headersList.length)]['User-Agent'];

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

export async function createStealthBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === 'production') {
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
      '--disable-gpu',
      '--disable-extensions',
      '--disable-automation',
      '--disable-save-password-bubble',
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
      '--disable-automation',
      '--disable-save-password-bubble',
      '--exclude-switches=enable-automation',
    ],
  })
}

export function randomDelay(min = 1000, max = 3000): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

export async function createStealthBrowserContext(browser: Browser): Promise<BrowserContext> {
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
    // Cache objects to avoid recreating them on every access
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

