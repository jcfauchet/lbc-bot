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

export class LeBonCoinApiClient implements IListingSource {
  private readonly API_BASE_URL = 'https://api.leboncoin.fr'
  private readonly SEARCH_ENDPOINT = `${this.API_BASE_URL}/finder/search`
  private cookies: string = ''

  async scrape(searchUrl: string, searchName?: string): Promise<ScrapedListing[]> {
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

      // Make API request with headers similar to the TypeScript lib
      const response = await fetch(this.SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Host': 'api.leboncoin.fr',
          'Connection': 'keep-alive',
          'Accept': 'application/json',
          'User-Agent': 'LBC;iOS;16.4.1;iPhone;phone;AFACB532-200B-476A-98B3-B2346A97EA54;wifi;6.102.0;24.32.1930',
          'api_key': 'ba0c2dad52b3ec',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          'Content-Type': 'application/json',
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

  private buildPayloadFromUrl(url: URL, searchName?: string): any {
    const searchParams = url.searchParams
    const payload: any = {
      filters: {
        category: undefined,
        enums: {},
        keywords: undefined,
        ranges: {},
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
      owner_type: 'all', // 'all', 'private', 'pro'
      sort_by: 'time', // 'time', 'price', 'relevance'
      sort_order: 'desc', // 'asc', 'desc'
    }

    // Text search - use searchName directly
    if (searchName) {
      payload.filters.keywords = {
        text: searchName,
        type: 'all', // 'all' for full text search, 'subject' for title only
      }
    }

    // Category
    const category = searchParams.get('category')
    if (category) {
      payload.filters.category = {
        id: category,
      }
    }

    // Locations
    const locations = searchParams.get('locations')
    if (locations) {
      payload.filters.location.locations = []

      const locationParts = locations.split(',')
      for (const location of locationParts) {
        const parts = location.split('__')
        if (parts.length >= 2) {
          const areaValues = parts[1].split('_')
          payload.filters.location.locations.push({
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
    }

    // Sort
    const sort = searchParams.get('sort')
    if (sort) {
      payload.sort_by = sort
    }

    // Order
    const order = searchParams.get('order')
    if (order) {
      payload.sort_order = order
    }

    // Price range
    const price = searchParams.get('price')
    if (price) {
      const [min, max] = price.split('-').map((p) => parseInt(p))
      payload.filters.ranges.price = {}
      if (min && !isNaN(min)) payload.filters.ranges.price.min = min
      if (max && !isNaN(max)) payload.filters.ranges.price.max = max
    }

    // Square range
    const square = searchParams.get('square')
    if (square) {
      const [min, max] = square.split('-').map((s) => parseInt(s))
      payload.filters.ranges.square = {}
      if (min && !isNaN(min)) payload.filters.ranges.square.min = min
      if (max && !isNaN(max)) payload.filters.ranges.square.max = max
    }

    // Enums (for filters like real_estate_type, etc.)
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'text' && key !== 'category' && key !== 'locations' && key !== 'sort' && key !== 'order' && key !== 'price' && key !== 'square' && key !== 'page') {
        if (value.includes(',')) {
          // Multiple values
          payload.filters.enums[key] = value.split(',')
        } else if (!value.includes('-')) {
          // Single enum value
          payload.filters.enums[key] = [value]
        }
      }
    }

    // Always set ad_type to 'offer' by default (like the TypeScript lib does)
    if (!payload.filters.enums.ad_type) {
      payload.filters.enums.ad_type = ['offer']
    }

    // Clean up undefined values
    if (!payload.filters.keywords) {
      delete payload.filters.keywords
    }
    if (!payload.filters.category) {
      delete payload.filters.category
    }
    if (Object.keys(payload.filters.ranges).length === 0) {
      delete payload.filters.ranges
    }
    if (Object.keys(payload.filters.enums).length === 0) {
      delete payload.filters.enums
    }
    if (payload.filters.location.locations.length === 0) {
      // Keep location with shippable if no locations specified
    }

    return payload
  }

  async scrapeDetails(listingUrl: string): Promise<{
    description?: string
    imageUrls: string[]
  }> {
    try {
      // Extract ad ID from URL
      const adIdMatch = listingUrl.match(/\/(\d+)\.htm/)
      if (!adIdMatch) {
        return { imageUrls: [] }
      }

      const adId = adIdMatch[1]
      const response = await fetch(`${this.API_BASE_URL}/api/adfinder/v1/classified/${adId}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Origin': 'https://www.leboncoin.fr',
          'Referer': 'https://www.leboncoin.fr/',
        },
      })

      if (!response.ok) {
        return { imageUrls: [] }
      }

      const data = await response.json()

      return {
        description: data.body || '',
        imageUrls: data.images?.urls || [],
      }
    } catch (error) {
      console.error('Detail scraping error:', error)
      return { imageUrls: [] }
    }
  }

  async close(): Promise<void> {
    // No browser to close for API scraper
  }
}



