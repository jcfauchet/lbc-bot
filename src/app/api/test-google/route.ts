import { GoogleCustomSearchScraper } from "@/infrastructure/scraping/reference/Google/GoogleCustomSearchScraper"
import { NextResponse } from "next/server"

export async function GET() {
  const imageUrl = 'https://images.selency.com/843c7e45-98d2-4fbd-82e2-d98a622992dc?bg_colour=f5f5f5&width=1762&height=1144&func=bound'
  const scraper = new GoogleCustomSearchScraper()
  const results = await scraper.scrape(imageUrl)
  console.log(results)
  return NextResponse.json(results)
}