import { IngestionService } from '@/infrastructure/scraping/IngestionService';
import { SiteScraper } from '@/domain/scraping/types';
import { PamonoScraper } from '@/infrastructure/scraping/reference/PamonoScraper';
import { FirstDibsScraper } from '@/infrastructure/scraping/reference/FirstDibsScraper';
import { PrismaClient } from '@prisma/client';

export class RunReferenceScrapersUseCase {
  private scrapers: SiteScraper[];

  constructor(
    private ingestionService: IngestionService,
    private prisma: PrismaClient
  ) {
    this.scrapers = [];
  }

  private async initializeScrapers() {
    if (this.scrapers.length > 0) {
      return;
    }

    // const pamonoSource = await this.prisma.referenceSiteSource.findUnique({
    //   where: { name: 'Pamono' },
    // });

    // if (pamonoSource) {
    //   const startUrl = pamonoSource.startUrl;
    //   this.scrapers.push(
    //     new PamonoScraper(startUrl || undefined)
    //   );
    // }

    const firstDibsSource = await this.prisma.referenceSiteSource.findUnique({
      where: { name: '1stdibs' },
    });

    if (firstDibsSource) {
      const startUrl = firstDibsSource.startUrl;
      this.scrapers.push(
        new FirstDibsScraper(startUrl || undefined)
      );
    }
  }

  async execute() {
    console.log('Starting scraping job...');
    
    await this.initializeScrapers();
    
    for (const scraper of this.scrapers) {
      console.log(`Running scraper: ${scraper.sourceName}`);
      try {
        const listings = await scraper.scrape();
        console.log(`Scraped ${listings.length} listings from ${scraper.sourceName}`);

        let processedCount = 0;
        for (const listing of listings) {
          try {
            await this.ingestionService.ingestRawListing(listing);
            processedCount++;
          } catch (error) {
            console.error(`Error ingesting listing ${listing.sourceListingId} from ${scraper.sourceName}:`, error);
          }
        }
        console.log(`Successfully processed ${processedCount} listings from ${scraper.sourceName}`);

      } catch (error) {
        console.error(`Error running scraper ${scraper.sourceName}:`, error);
      }
    }

    console.log('Scraping job completed.');
  }
}
