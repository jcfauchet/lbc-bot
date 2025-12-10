import { CATEGORIES_TO_EXCLUDE_FROM_LBC } from '../config/constants'
import { env } from '../config/env'
import { ScrapedListing } from '../scraping/types'
import { IListingSource } from '@/domain/services/IListingSource'
import { DataDomeBypass } from './DataDomeBypass'
import { ProxyManager } from '../proxy/ProxyManager'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { HttpProxyAgent } from 'http-proxy-agent'

interface RequestInitWithAgent extends RequestInit {
  agent?: any
}

interface LeBonCoinApiResponse {
  ads: Array<{
    list_id: number
    first_publication_date: string
    index_date: string
    status: string
    category_id: string
    category_name: string
    subject: string
    body: string
    ad_type: string
    url: string
    price: number[]
    images: {
      thumb_url: string
      small_url: string
      urls: string[]
    }
    attributes: Array<{
      key: string
      value: string | number
      label: string
      generic_label: string
    }>
    location: {
      city: string
      zipcode: string
      region_id: string
      region_name: string
      department_id: string
      department_name: string
    }
    owner: {
      name: string
      type: string
      no_salesmen?: boolean
    }
    options: {
      has_option: boolean
      booster: boolean
      photosup: boolean
      urgent: boolean
      gallery: boolean
      sub_toplist: boolean
    }
    has_phone: boolean
    professional_ad: boolean
  }>
  total: number
  total_pages: number
}



interface SearchPayload {
  filters: {
    category?: { id: string }
    enums?: Record<string, string[]>
    keywords?: { text: string; type: 'all' | 'subject' }
    ranges?: Record<string, { min?: number; max?: number }>
    location: {
      locations: Array<{
        locationType: string
        area: {
          lat: number
          lng: number
          default_radius: number
          radius: number
        }
      }>
      shippable: boolean
    }
  }
  limit: number
  limit_alu: number
  offset: number
  disable_total: boolean
  extend: boolean
  listing_source: string
  owner_type: string
  sort_by: string
  sort_order: string
}

export class LeBonCoinApiClient implements IListingSource {
  private readonly API_BASE_URL = 'https://api.leboncoin.fr'
  private readonly SEARCH_ENDPOINT = `${this.API_BASE_URL}/finder/search`
  private cookies: string = ''
  private readonly bypass: DataDomeBypass
  private readonly proxyManager: ProxyManager | null
  
  private readonly HARDCODED_COOKIE = 'didomi_token=eyJ2ZW5kb3JzIjp7ImRpc2FibGVkIjpbImM6YWRqdXN0Z21iLXBjY05kSkJRIiwiYzpicmFuY2gtVjJkRUJSeEoiLCJjOmNhYmxhdG9saS1uUm1WYXdwMiIsImM6Zm9ydHZpc2lvbi1pZTZiWFR3OSIsImM6aW5mZWN0aW91cy1tZWRpYSIsImM6aGFzb2ZmZXItOFl5TVR0WGkiLCJjOnNhbm9tYSIsImM6cHVib2NlYW4tYjZCSk10c2UiLCJjOmFiLXRhc3R5IiwiYzpyZWFsemVpdGctYjZLQ2t4eVYiLCJjOmludG93b3dpbi1xYXp0NXRHaSIsImM6cHVycG9zZWxhLTN3NFpmS0tEIiwiYzptb2JpZnkiLCJjOnRpa3Rvay1LWkFVUUxaOSIsImM6aWxsdW1hdGVjLUNodEVCNGVrIiwiYzp3aGVuZXZlcm0tOFZZaHdiMlAiLCJjOnJldGFyZ2V0ZXItYmVhY29uIiwiYzpqcXVlcnkiLCJjOnJ0YXJnZXQtR2VmTVZ5aUMiLCJjOnlvcm1lZGlhcy1xbkJXaFF5UyIsImM6YWRsaWdodG5pLXRXWkdyZWhUIiwiYzppbnRpbWF0ZS1tZXJnZXIiLCJjOnNuYXBpbmMteWhZbkpaZlQiLCJjOmRpZG9taSIsImM6cXdlcnRpemUtemRuZ0UyaHgiLCJjOnJldmxpZnRlci1jUnBNbnA1eCIsImM6c2NoaWJzdGVkLU1RUFhhcXloIiwiYzpjbG91ZGZsYXJlIiwiYzp2aWFudC00N3gyWWhmNyIsImM6cm9ja2VyYm94LWZUTThFSjlQIiwiYzphZG1vdGlvbiIsImM6bWF4Y2RuLWlVTXROcWNMIiwiYzphZHZhbnNlLUg2cWJheG5RIiwiYzpsa3FkLWNVOVFtQjZXIiwiYzphcHBzZmx5ZXItWXJQZEdGNjMiLCJjOnZ1YmxlLWNNQ0pWeDRlIiwiYzpzd2F2ZW4tTFlCcmltQVoiLCJjOnNmci1NZHBpN2tmTiIsImM6b3NjYXJvY29tLUZSY2hOZG5IIiwiYzp0aGlyZHByZXNlLVNzS3dtSFZLIiwiYzphZGltby1QaFVWbTZGRSIsImM6cmV0ZW5jeS1DTGVyWmlHTCIsImM6Y3JlYXRlanMiLCJjOmdyZWVuaG91c2UtUUtiR0JrczQiLCJjOmxlbW9tZWRpYS16YllocDJRYyIsImM6emFub3giLCJjOmxiY2ZyYW5jZSIsImM6cmVzZWFyY2gtbm93IiwiYzptYXl0cmljc2ctQVMzNVlhbTkiLCJjOmFmZmlsaW5ldCIsImM6cm9ja3lvdSIsImM6cmFkdmVydGlzLVNKcGEyNUg4IiwiYzpha2FtYWkiLCJjOnR1cmJvIiwiYzphdC1pbnRlcm5ldCJdLCJlbmFibGVkIjpbXX0sInB1cnBvc2VzIjp7ImRpc2FibGVkIjpbIm1lYXN1cmVfYWRfcGVyZm9ybWFuY2UiLCJzZWxlY3RfcGVyc29uYWxpemVkX2FkcyIsImNvb2tpZXMiLCJtYXJrZXRfcmVzZWFyY2giLCJnZW9sb2NhdGlvbl9kYXRhIiwiZGV2aWNlX2NoYXJhY3RlcmlzdGljcyIsImltcHJvdmVfcHJvZHVjdHMiLCJwZXJzb25uYWxpc2F0aW9ubWFya2V0aW5nIiwiY3JlYXRlX2Fkc19wcm9maWxlIiwicHJpeCIsImV4cGVyaWVuY2V1dGlsYXRldXIiLCJ1c2VfbGltaXRlZF9kYXRhX3RvX2NvbnRlbnQiLCJtZXN1cmVhdWRpZW5jZSIsInNlbGVjdF9iYXNpY19hZHMiXSwiZW5hYmxlZCI6WyJuZWNlc3NhaXJlcyJdfSwidXNlcl9pZCI6IjdDQTRBQ0NBLUU1ODgtNDA1NS05MkFBLUJCNzFFRDA2QjRCQiJ9; datadome=fY_S~5q2DUa_EgbQ_geUQr9aRO~TjqElbKqJcUrq~Mjfc~sp2nY9pX9Qw2GrGu6wDynd6oLCou~bUL69LG6DkOtDUaJB6Gfr_sqQZsN4pt0tG8NPuy_25tkGSn6z_s_M'
  private useHardcodedCookie: boolean = false

  constructor() {
    this.bypass = new DataDomeBypass()
    this.proxyManager = env.PROXY_ENABLED && env.PROXY_LIST && env.PROXY_LIST.length > 0
      ? new ProxyManager(env.PROXY_LIST)
      : null
  }

  async search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]> {
    const randomDelay = this.bypass.getRandomDelayBeforeRequest()
    console.log(`⏳ Waiting ${randomDelay}ms before API request to avoid DataDome blocking...`)
    await this.bypass.delay(randomDelay)

    return this.bypass.retryWithBackoff(
      async () => {
        const sessionDelay = Math.floor(Math.random() * 2000) + 1000
        await this.bypass.delay(sessionDelay)
        
        this.cookies = ''
        await this.initSession()
        
        const requestDelay = Math.floor(Math.random() * 2000) + 1000
        await this.bypass.delay(requestDelay)

        const url = new URL(searchUrl)
        const payload = this.buildPayloadFromUrl(url, searchName)

        const userAgentConfig = this.bypass.getRandomUserAgentConfig()
        const apiHeaders = this.bypass.generateApiHeaders(userAgentConfig)

        console.log('🔍 API Request:', {
          url: searchUrl,
          userAgent: userAgentConfig.userAgent.substring(0, 50) + '...',
          deviceId: userAgentConfig.deviceId,
        })

        const cookieHeader = this.useHardcodedCookie 
          ? this.HARDCODED_COOKIE 
          : this.cookies || this.HARDCODED_COOKIE

        const fetchOptions: RequestInitWithAgent = {
          method: 'POST',
          headers: {
            ...apiHeaders,
            'Cookie': cookieHeader,
          },
          body: JSON.stringify(payload),
        }

        if (this.proxyManager && this.proxyManager.hasProxies()) {
          const proxy = this.proxyManager.getNextProxy()
          if (proxy) {
            const proxyUrl = this.proxyManager.getProxyUrl(proxy)
            const proxyIndex = (this.proxyManager as any).proxies.indexOf(proxy)
            
            console.log(`🔄 [LeBonCoin API] Using proxy ${proxyIndex + 1}/${this.proxyManager.getProxyCount()}: ${proxy.host}:${proxy.port}`)
            
            if (this.SEARCH_ENDPOINT.startsWith('https://')) {
              fetchOptions.agent = new HttpsProxyAgent(proxyUrl) as any
            } else {
              fetchOptions.agent = new HttpProxyAgent(proxyUrl) as any
            }
          }
        }

        const response = await fetch(this.SEARCH_ENDPOINT, fetchOptions)

        if (!response.ok) {
          if (this.proxyManager && this.proxyManager.hasProxies() && fetchOptions.agent) {
            const currentProxy = (this.proxyManager as any).proxies.find((p: any) => {
              const agent = fetchOptions.agent as any
              return agent?.proxy?.href?.includes(p.host) || 
                     agent?.proxy?.hostname === p.host
            })
            if (currentProxy) {
              const proxyIndex = (this.proxyManager as any).proxies.indexOf(currentProxy)
              this.proxyManager.recordProxyFailure(proxyIndex)
            }
          }
          
          if (response.status === 403 || response.status === 429) {
            const errorText = await response.text().catch(() => '')
            if (errorText.includes('datadome') || errorText.includes('DataDome') || response.status === 403) {
              if (!this.useHardcodedCookie) {
                console.log('🔄 Switching to hardcoded cookie fallback...')
                this.useHardcodedCookie = true
              }
              throw new Error('Access blocked by Datadome. The API request was rejected.')
            }
          }
          throw new Error(`API request failed with status ${response.status}`)
        }

        if (this.proxyManager && this.proxyManager.hasProxies() && fetchOptions.agent) {
          const currentProxy = (this.proxyManager as any).proxies.find((p: any) => {
            const agent = fetchOptions.agent as any
            return agent?.proxy?.href?.includes(p.host) || 
                   agent?.proxy?.hostname === p.host
          })
          if (currentProxy) {
            const proxyIndex = (this.proxyManager as any).proxies.indexOf(currentProxy)
            this.proxyManager.recordProxySuccess(proxyIndex)
          }
        }
        
        if (this.useHardcodedCookie) {
          this.useHardcodedCookie = false
          console.log('✅ Hardcoded cookie worked, switching back to dynamic cookies')
        }

        const data: LeBonCoinApiResponse = await response.json()

        console.log(`📊 API Response: ${data.ads?.length || 0} ads found`)

        const now = new Date()
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)


        return data.ads
          .filter((ad) => {
            if (!ad.price || ad.price.length === 0) return false

            if (ad.professional_ad || ad.owner.type === 'pro') return false
            
            if (ad.first_publication_date) {
              const publicationDate = new Date(ad.first_publication_date)
              if (publicationDate < twentyFourHoursAgo) {
                return false
              }
            }

            console.log(`Ad ${ad.list_id} in category ${ad.category_name}`)

            if (CATEGORIES_TO_EXCLUDE_FROM_LBC.includes(ad.category_name)) {
              console.log(`Excluding ad ${ad.list_id} in category ${ad.category_name}`)
              return false
            }
            
            return true
          })
          .map((ad) => ({
            lbcId: ad.list_id.toString(),
            url: ad.url.startsWith('http') ? ad.url : `https://www.leboncoin.fr${ad.url}`,
            title: ad.subject,
            priceCents: ad.price[0] * 100,
            city: ad.location?.city || '',
            region: ad.location?.region_name || '',
            publishedAt: ad.first_publication_date ? new Date(ad.first_publication_date) : undefined,
            imageUrls: ad.images?.urls || ad.images?.small_url ? [ad.images.small_url] : [],
          }))
          .filter((l) => l.lbcId && l.title)
          .filter((l) => l.priceCents >= env.MIN_LISTING_PRICE_EUR * 100)
          .filter((l) => l.priceCents <= env.MAX_LISTING_PRICE_EUR * 100)
      },
      5,
      (attempt, error) => {
        console.log(`⚠️ DataDome bypass attempt ${attempt}: ${error.message}`)
        if (attempt >= 3) {
          const extraDelay = Math.floor(Math.random() * 10000) + 5000
          console.log(`🛑 Multiple failures detected, waiting ${extraDelay}ms before next attempt...`)
          return this.bypass.delay(extraDelay)
        }
      }
    )
  }

  private async initSession(): Promise<void> {
    if (this.useHardcodedCookie) {
      this.cookies = this.HARDCODED_COOKIE
      console.log('🍪 Using hardcoded cookie for session')
      return
    }

    const browserUserAgent = this.bypass.getRandomBrowserUserAgent()
    const browserHeaders = this.bypass.generateBrowserHeaders(browserUserAgent)

    const fetchOptions: RequestInitWithAgent = {
      headers: browserHeaders,
    }

    if (this.proxyManager && this.proxyManager.hasProxies()) {
      const proxy = this.proxyManager.getNextProxy()
      if (proxy) {
        const proxyUrl = this.proxyManager.getProxyUrl(proxy)
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl) as any
      }
    }

    const response = await fetch('https://www.leboncoin.fr/', fetchOptions)

    const setCookieHeader = response.headers.get('set-cookie')
    if (setCookieHeader) {
      const cookies = setCookieHeader.split(',').map((cookie) => cookie.split(';')[0].trim())
      this.cookies = cookies.join('; ')
      
      if (this.cookies) {
        console.log(`🍪 Session initialized with cookies (${this.cookies.split(';').length} cookies)`)
      } else {
        console.log('⚠️ No cookies received, falling back to hardcoded cookie')
        this.cookies = this.HARDCODED_COOKIE
      }
    } else {
      console.log('⚠️ No set-cookie header, using hardcoded cookie')
      this.cookies = this.HARDCODED_COOKIE
    }
  }

  private buildPayloadFromUrl(url: URL, searchName?: string): SearchPayload {
    const searchParams = url.searchParams
    const payload: SearchPayload = {
      filters: {
        location: {
          locations: [],
          shippable: true,
        },
      },
      limit: 35,
      limit_alu: 3,
      offset: 0,
      disable_total: true,
      extend: true,
      listing_source: 'direct-search',
      owner_type: 'all',
      sort_by: 'time',
      sort_order: 'desc',
    }

    if (searchName) {
      payload.filters.keywords = {
        text: searchName,
        type: 'all',
      }
    }

    const category = searchParams.get('category')
    if (category) {
      payload.filters.category = { id: category }
    }

    const locations = searchParams.get('locations')
    if (locations) {
      payload.filters.location.locations = this.parseLocations(locations)
    }

    const sort = searchParams.get('sort')
    if (sort) {
      payload.sort_by = sort
    }

    const order = searchParams.get('order')
    if (order) {
      payload.sort_order = order
    }

    const ranges = this.parseRanges(searchParams)
    if (Object.keys(ranges).length > 0) {
      payload.filters.ranges = ranges
    }

    const enums = this.parseEnums(searchParams)
    if (Object.keys(enums).length > 0) {
      payload.filters.enums = enums
    }

    return payload
  }

  private parseLocations(locationsParam: string): SearchPayload['filters']['location']['locations'] {
    const locations: SearchPayload['filters']['location']['locations'] = []
    const locationParts = locationsParam.split(',')

    for (const location of locationParts) {
      const parts = location.split('__')
      if (parts.length >= 2) {
        const areaValues = parts[1].split('_')
        locations.push({
          locationType: 'city',
          area: {
            lat: parseFloat(areaValues[0]),
            lng: parseFloat(areaValues[1]),
            default_radius: areaValues[2] ? parseInt(areaValues[2]) : 10000,
            radius: areaValues[3] ? parseInt(areaValues[3]) : 10000,
          },
        })
      }
    }

    return locations
  }

  private parseRanges(searchParams: URLSearchParams): Record<string, { min?: number; max?: number }> {
    const ranges: Record<string, { min?: number; max?: number }> = {}

    const price = searchParams.get('price')
    if (price) {
      const [min, max] = price.split('-').map((p) => parseInt(p))
      ranges.price = {}
      if (min && !isNaN(min)) ranges.price.min = min
      if (max && !isNaN(max)) ranges.price.max = max
    }

    const square = searchParams.get('square')
    if (square) {
      const [min, max] = square.split('-').map((s) => parseInt(s))
      ranges.square = {}
      if (min && !isNaN(min)) ranges.square.min = min
      if (max && !isNaN(max)) ranges.square.max = max
    }

    return ranges
  }

  private parseEnums(searchParams: URLSearchParams): Record<string, string[]> {
    const enums: Record<string, string[]> = {}
    const excludedKeys = ['text', 'category', 'locations', 'sort', 'order', 'price', 'square', 'page']

    for (const [key, value] of searchParams.entries()) {
      if (!excludedKeys.includes(key)) {
        if (value.includes(',')) {
          enums[key] = value.split(',')
        } else if (!value.includes('-')) {
          enums[key] = [value]
        }
      }
    }

    if (!enums.ad_type) {
      enums.ad_type = ['offer']
    }

    return enums
  }

}



