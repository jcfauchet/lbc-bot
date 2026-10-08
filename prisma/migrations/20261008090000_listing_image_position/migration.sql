-- Ads now keep every photo; 0 is the cover. Existing rows hold one photo each.
ALTER TABLE "listing_images" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
