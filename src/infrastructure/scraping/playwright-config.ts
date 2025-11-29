import playwright, { chromium as chromiumOrigin, Browser, BrowserContext } from 'playwright-core';
import chromium from '@sparticuz/chromium';

export async function createBrowserForVercel(): Promise<Browser> {
  const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;
  
  if (isVercel) {
    return await playwright.chromium.launch({
      headless: true,
      timeout: 120_000,
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    });
  }
  
  return await chromiumOrigin.launch({
    headless: true,
    timeout: 120_000,
  });
}

export async function createBrowserContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
}

