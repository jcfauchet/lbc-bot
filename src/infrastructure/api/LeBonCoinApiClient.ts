import { CATEGORIES_TO_EXCLUDE_FROM_LBC } from '../config/constants'
import { env } from '../config/env'
import { ScrapedListing } from '../scraping/types'
import { IListingSource } from '@/domain/services/IListingSource'

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

const API_HEADERS = {
  'Host': 'api.leboncoin.fr',
  'Connection': 'keep-alive',
  'Accept': 'application/json',
  'User-Agent': 'LBC;iOS;16.4.1;iPhone;phone;AFACB532-200B-476A-98B3-B2346A97EA54;wifi;6.102.0;24.32.1930',
  'api_key': 'ba0c2dad52b3ec',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Content-Type': 'application/json',
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

  async search(searchUrl: string, searchName?: string): Promise<ScrapedListing[]> {
    try {
      // Initialize session by visiting the main page to get cookies
      if (!this.cookies) {
        await this.initSession()
      }

      // Parse the search URL to extract parameters
      const url = new URL(searchUrl)
      const payload = this.buildPayloadFromUrl(url, searchName)

      console.log('🔍 API Request:', {
        url: searchUrl,
        payload: JSON.stringify(payload, null, 2),
      })

      const response = await fetch(this.SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          'Cookie': this.cookies,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Access blocked by Datadome. The API request was rejected.')
        }
        throw new Error(`API request failed with status ${response.status}`)
      }

      const data: LeBonCoinApiResponse = await response.json()

      console.log(`📊 API Response: ${data.ads?.length || 0} ads found`)

      // Filter ads published in the last 24 hours
      const now = new Date()
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      // Transform API response to ScrapedListing format
      return data.ads
        .filter((ad) => {
          // Filter by price
          if (!ad.price || ad.price.length === 0) return false
          
          // Filter by publication date (last 24 hours)
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
          priceCents: ad.price[0] * 100, // Convert euros to cents
          city: ad.location?.city || '',
          region: ad.location?.region_name || '',
          publishedAt: ad.first_publication_date ? new Date(ad.first_publication_date) : undefined,
          imageUrls: ad.images?.urls || ad.images?.small_url ? [ad.images.small_url] : [],
        }))
        .filter((l) => l.lbcId && l.title)
        .filter((l) => l.priceCents >= env.MIN_LISTING_PRICE_EUR * 100)
    } catch (error) {
      console.error('API scraping error:', error)
      throw error
    }
  }

  private async initSession(): Promise<void> {
    // Visit the main page to initialize cookies (like the Python lib does)
    const response = await fetch('https://www.leboncoin.fr/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    })

    // Extract cookies from response headers
    const setCookieHeader = response.headers.get('set-cookie')
    if (setCookieHeader) {
      // Parse multiple cookies if present
      const cookies = setCookieHeader.split(',').map((cookie) => cookie.split(';')[0].trim())
      this.cookies = cookies.join('; ')
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



