ALTER TABLE "photo_references" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
CREATE INDEX "photo_references_source_isActive_idx" ON "photo_references"("source", "isActive");

CREATE TABLE "auction_lots" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "saleRef" TEXT NOT NULL,
    "lotRef" TEXT NOT NULL,
    "lotUrl" TEXT NOT NULL,
    "saleName" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "artistYears" TEXT,
    "description" TEXT NOT NULL,
    "estimateLowCents" INTEGER,
    "estimateHighCents" INTEGER,
    "hammerCents" INTEGER NOT NULL,
    "finalCents" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "hammerPerUnitCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auction_lots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auction_lots_referenceId_key" ON "auction_lots"("referenceId");
CREATE UNIQUE INDEX "auction_lots_house_saleRef_lotRef_key" ON "auction_lots"("house", "saleRef", "lotRef");
ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_referenceId_fkey"
  FOREIGN KEY ("referenceId") REFERENCES "photo_references"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The reference fund holds ~30k vectors once the auction lots are loaded; a
-- sequential scan per listing photo is no longer acceptable.
CREATE INDEX "reference_images_embedding_hnsw_idx" ON "reference_images" USING hnsw ("embedding" vector_cosine_ops);
