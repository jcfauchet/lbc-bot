# Scraping Cron Job Configuration

## Overview
The scraping module is configured to run automatically via Vercel Cron Jobs.

## Cron Schedule
- **Path**: `/api/cron/scrapers`
- **Schedule**: `0 2 * * *` (Every day at 2:00 AM UTC)

## Environment Variables
Add the following to your `.env` file (and Vercel environment variables):

```bash
CRON_SECRET=your-secure-random-string-here
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

## Manual Execution

### Via CLI
```bash
npx tsx src/cli/run-scrapers.ts
```

### Via API (local or deployed)
```bash
curl -X GET http://localhost:3000/api/cron/scrapers \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Configuration

The cron job is configured in `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/scrapers",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## Architecture

```
src/
├── application/
│   └── use-cases/
│       └── RunScrapersUseCase.ts    # Use case orchestration
├── infrastructure/
│   └── scraping/
│       ├── IngestionService.ts      # Data ingestion logic
│       └── scrapers/
│           └── pamono.scraper.ts    # Scraper implementations
└── app/
    └── api/
        └── cron/
            └── scrapers/
                └── route.ts          # API endpoint for cron
```

## Adding New Scrapers

1. Create a new scraper in `src/infrastructure/scraping/scrapers/`
2. Implement the `SiteScraper` interface
3. Register it in `RunScrapersUseCase.ts`

Example:
```typescript
import { NewScraper } from '@/infrastructure/scraping/scrapers/new.scraper';

this.scrapers = [
  new PamonoScraper(),
  new NewScraper(),
];
```
