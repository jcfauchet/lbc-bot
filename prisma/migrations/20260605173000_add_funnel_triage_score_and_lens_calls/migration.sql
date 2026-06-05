-- Additive-only funnel schema changes.
-- Idempotent because the production database may already have been patched manually.
ALTER TABLE "lbc_product_listings" ADD COLUMN IF NOT EXISTS "triageScore" INTEGER;

CREATE TABLE IF NOT EXISTS "lens_calls" (
  "id" TEXT NOT NULL,
  "listingId" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lens_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lens_calls_createdAt_idx" ON "lens_calls" ("createdAt");
