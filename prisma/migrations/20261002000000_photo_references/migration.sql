CREATE TABLE "photo_references" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxPriceCents" INTEGER,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photo_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reference_images" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "urlRemote" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reference_images_referenceId_idx" ON "reference_images"("referenceId");
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "photo_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reference_matches" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reference_matches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reference_matches_referenceId_listingId_key" ON "reference_matches"("referenceId", "listingId");
CREATE INDEX "reference_matches_listingId_idx" ON "reference_matches"("listingId");
ALTER TABLE "reference_matches" ADD CONSTRAINT "reference_matches_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "photo_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reference_matches" ADD CONSTRAINT "reference_matches_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "lbc_product_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Listing photo fingerprints, stored so a new reference can be checked against
-- recent ads without re-embedding them.
ALTER TABLE "listing_images" ADD COLUMN "embedding" vector(768);

-- The matching stage's own progress marker, independent of status.
ALTER TABLE "lbc_product_listings" ADD COLUMN "referenceCheckedAt" TIMESTAMP(3);
-- Only the last 7 days are worth checking; older ads are mostly gone.
UPDATE "lbc_product_listings" SET "referenceCheckedAt" = CURRENT_TIMESTAMP
  WHERE "createdAt" < CURRENT_TIMESTAMP - INTERVAL '7 days';
CREATE INDEX "lbc_product_listings_reference_pending_idx"
  ON "lbc_product_listings"("createdAt") WHERE "referenceCheckedAt" IS NULL;
