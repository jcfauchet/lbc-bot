import { NextResponse } from 'next/server'
import { container } from '@/infrastructure/di/container'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let listings
    
    if (status) {
      listings = await container.listingRepository.findByStatus(status as any)
    } else {
      listings = await container.listingRepository.findAll()
    }

    const listingsWithAnalysis = await Promise.all(
      listings.map(async (listing) => {
        const analysis = await container.aiAnalysisRepository.findByListingId(
          listing.id
        )
        return {
          id: listing.id,
          lbcId: listing.lbcId,
          url: listing.url,
          title: listing.title,
          price: listing.price.getCents(),
          city: listing.city,
          region: listing.region,
          publishedAt: listing.publishedAt,
          status: listing.status,
          createdAt: listing.createdAt,
          analysis: analysis
            ? {
                estimatedMinPrice: analysis.estimatedMinPrice.getCents(),
                estimatedMaxPrice: analysis.estimatedMaxPrice.getCents(),
                margin: analysis.margin.getEuros(),
                description: analysis.description,
              }
            : null,
        }
      })
    )

    return NextResponse.json({
      success: true,
      data: listingsWithAnalysis,
    })
  } catch (error) {
    console.error('Error fetching listings:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch listings' },
      { status: 500 }
    )
  }
}

