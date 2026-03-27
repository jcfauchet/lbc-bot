-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "listing_feedbacks" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "isGood" BOOLEAN NOT NULL,
    "comment" TEXT,
    "embedding" vector(1536),
    "embeddingText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_feedbacks_listingId_idx" ON "listing_feedbacks"("listingId");

-- CreateIndex (vector cosine similarity)
CREATE INDEX "listing_feedbacks_embedding_idx" ON "listing_feedbacks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "listing_feedbacks" ADD CONSTRAINT "listing_feedbacks_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "lbc_product_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
