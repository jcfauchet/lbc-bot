interface UserAgentConfig {
  userAgent: string
  apiKey: string
  deviceId: string
  headers: Record<string, string>
}

export class DataDomeBypass {
  private static readonly USER_AGENTS: UserAgentConfig[] = [
    {
      userAgent: 'LBC;iOS;16.4.1;iPhone;phone;AFACB532-200B-476A-98B3-B2346A97EA54;wifi;6.102.0;24.32.1930',
      apiKey: 'ba0c2dad52b3ec',
      deviceId: 'AFACB532-200B-476A-98B3-B2346A97EA54',
      headers: {
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    },
    {
      userAgent: 'LBC;iOS;17.1.0;iPhone;phone;B123C456-789D-012E-345F-678901234567;wifi;6.105.0;24.35.2100',
      apiKey: 'ba0c2dad52b3ec',
      deviceId: 'B123C456-789D-012E-345F-678901234567',
      headers: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8',
      },
    },
    {
      userAgent: 'LBC;Android;13;Samsung Galaxy S23;phone;C789D012-345E-678F-901A-234567890123;wifi;6.102.0;24.32.1930',
      apiKey: 'ba0c2dad52b3ec',
      deviceId: 'C789D012-345E-678F-901A-234567890123',
      headers: {
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    },
    {
      userAgent: 'LBC;iOS;15.7.1;iPhone;phone;D456E789-012F-345A-678B-901234567890;wifi;6.100.0;24.30.1800',
      apiKey: 'ba0c2dad52b3ec',
      deviceId: 'D456E789-012F-345A-678B-901234567890',
      headers: {
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    },
  ]

  private static readonly BROWSER_USER_AGENTS: string[] = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  ]

  private currentConfigIndex: number = 0
  private failureCount: number = 0
  private lastFailureTime: number = 0

  getRandomUserAgentConfig(): UserAgentConfig {
    const index = Math.floor(Math.random() * DataDomeBypass.USER_AGENTS.length)
    this.currentConfigIndex = index
    return DataDomeBypass.USER_AGENTS[index]
  }

  getRandomBrowserUserAgent(): string {
    const index = Math.floor(Math.random() * DataDomeBypass.BROWSER_USER_AGENTS.length)
    return DataDomeBypass.BROWSER_USER_AGENTS[index]
  }

  getNextUserAgentConfig(): UserAgentConfig {
    this.currentConfigIndex = (this.currentConfigIndex + 1) % DataDomeBypass.USER_AGENTS.length
    return DataDomeBypass.USER_AGENTS[this.currentConfigIndex]
  }

  recordFailure(): void {
    this.failureCount++
    this.lastFailureTime = Date.now()
  }

  recordSuccess(): void {
    this.failureCount = 0
  }

  shouldRotateUserAgent(): boolean {
    return this.failureCount >= 2 || (Date.now() - this.lastFailureTime < 60000 && this.failureCount > 0)
  }

  getRetryDelay(attempt: number): number {
    const baseDelay = 5000
    const maxDelay = 60000
    const exponentialDelay = baseDelay * Math.pow(2, attempt)
    const jitter = Math.random() * 2000
    return Math.min(exponentialDelay + jitter, maxDelay)
  }

  getRandomDelayBeforeRequest(): number {
    return Math.floor(Math.random() * 5000) + 3000
  }

  async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    onRetry?: (attempt: number, error: Error) => void
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fn()
        this.recordSuccess()
        return result
      } catch (error) {
        lastError = error as Error
        this.recordFailure()

        if (error instanceof Error && error.message.includes('Datadome')) {
          if (this.shouldRotateUserAgent()) {
            this.getNextUserAgentConfig()
            console.log(`🔄 Rotating User-Agent due to DataDome detection (attempt ${attempt + 1}/${maxRetries})`)
          }
        }

        if (attempt < maxRetries - 1) {
          const delay = this.getRetryDelay(attempt)
          if (onRetry) {
            onRetry(attempt + 1, error as Error)
          }
          console.log(`⏳ Retrying after ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})...`)
          await this.delay(delay)
        }
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  generateApiHeaders(config: UserAgentConfig): Record<string, string> {
    return {
      'Host': 'api.leboncoin.fr',
      'Connection': 'keep-alive',
      'Accept': 'application/json',
      'User-Agent': config.userAgent,
      'api_key': config.apiKey,
      'Accept-Language': config.headers['Accept-Language'] || 'fr-FR,fr;q=0.9',
      'Content-Type': 'application/json',
      'Origin': 'https://www.leboncoin.fr',
      'Referer': 'https://www.leboncoin.fr/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    }
  }

  generateBrowserHeaders(userAgent: string): Record<string, string> {
    const isChrome = userAgent.includes('Chrome')
    const isFirefox = userAgent.includes('Firefox')
    const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome')

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    }

    if (isChrome) {
      headers['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
      headers['sec-ch-ua-mobile'] = '?0'
      headers['sec-ch-ua-platform'] = userAgent.includes('Macintosh') ? '"macOS"' : userAgent.includes('Windows') ? '"Windows"' : '"Linux"'
    }

    return headers
  }
}

