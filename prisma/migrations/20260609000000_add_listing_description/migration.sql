-- Persist the LeBonCoin listing body so the analysis pipeline can read the
-- seller's own words (e.g. "dans le style de", "réplique") instead of judging
-- the photo alone.
ALTER TABLE "lbc_product_listings" ADD COLUMN "description" TEXT;
