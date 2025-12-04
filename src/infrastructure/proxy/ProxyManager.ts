interface ProxyConfig {
  host: string
  port: number
  username?: string
  password?: string
  protocol?: 'http' | 'https' | 'socks5'
}

export class ProxyManager {
  private proxies: ProxyConfig[] = []
  private currentIndex: number = 0
  private failedProxies: Set<number> = new Set()
  private readonly maxFailuresPerProxy = 3
  private proxyFailureCount: Map<number, number> = new Map()

  constructor(proxyList?: string[]) {
    if (proxyList && proxyList.length > 0) {
      this.proxies = proxyList.map((proxy) => this.parseProxy(proxy))
    }
  }

  private parseProxy(proxyString: string): ProxyConfig {
    try {
      const url = new URL(proxyString.includes('://') ? proxyString : `http://${proxyString}`)
      
      return {
        host: url.hostname,
        port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
        username: url.username || undefined,
        password: url.password || undefined,
        protocol: (url.protocol.replace(':', '') as 'http' | 'https' | 'socks5') || 'http',
      }
    } catch (error) {
      throw new Error(`Invalid proxy format: ${proxyString}`)
    }
  }

  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null
    }

    const startIndex = this.currentIndex
    let attempts = 0

    do {
      const proxy = this.proxies[this.currentIndex]
      const failureCount = this.proxyFailureCount.get(this.currentIndex) || 0

      if (failureCount < this.maxFailuresPerProxy) {
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length
        return proxy
      }

      this.currentIndex = (this.currentIndex + 1) % this.proxies.length
      attempts++
    } while (attempts < this.proxies.length && this.currentIndex !== startIndex)

    this.resetFailedProxies()
    return this.proxies[this.currentIndex]
  }

  recordProxyFailure(proxyIndex: number): void {
    const currentCount = this.proxyFailureCount.get(proxyIndex) || 0
    this.proxyFailureCount.set(proxyIndex, currentCount + 1)
    
    if (currentCount + 1 >= this.maxFailuresPerProxy) {
      this.failedProxies.add(proxyIndex)
      console.log(`⚠️ Proxy ${proxyIndex} marked as failed (${currentCount + 1} failures)`)
    }
  }

  recordProxySuccess(proxyIndex: number): void {
    this.proxyFailureCount.delete(proxyIndex)
    this.failedProxies.delete(proxyIndex)
  }

  private resetFailedProxies(): void {
    if (this.failedProxies.size === this.proxies.length) {
      console.log('🔄 All proxies failed, resetting failure counts...')
      this.failedProxies.clear()
      this.proxyFailureCount.clear()
    }
  }

  getProxyUrl(proxy: ProxyConfig): string {
    if (proxy.username && proxy.password) {
      return `${proxy.protocol || 'http'}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    }
    return `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`
  }

  getProxyForFetch(proxy: ProxyConfig): { host: string; port: number; auth?: { username: string; password: string } } {
    return {
      host: proxy.host,
      port: proxy.port,
      ...(proxy.username && proxy.password ? {
        auth: {
          username: proxy.username,
          password: proxy.password,
        },
      } : {}),
    }
  }

  getProxyForPlaywright(proxy: ProxyConfig): { server: string; username?: string; password?: string } {
    return {
      server: `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`,
      ...(proxy.username && proxy.password ? {
        username: proxy.username,
        password: proxy.password,
      } : {}),
    }
  }

  hasProxies(): boolean {
    return this.proxies.length > 0
  }

  getProxyCount(): number {
    return this.proxies.length
  }
}

