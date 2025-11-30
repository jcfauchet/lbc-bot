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
  return await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
}

