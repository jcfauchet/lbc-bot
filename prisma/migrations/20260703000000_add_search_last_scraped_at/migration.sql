-- The scrape run processes searches in a fixed order and often dies midway
-- (Datadome block / serverless timeout), so tail searches were NEVER scraped
-- (observed: 6 of 17 searches starved with ~0 listings). Track when each
-- search was last scraped so the run can serve the most-starved search first.
ALTER TABLE "searches" ADD COLUMN "lastScrapedAt" TIMESTAMP(3);
