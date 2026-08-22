-- Every analyze-and-notify tick (96 a day) expires the stale TRIAGED backlog
-- with `status = 'triaged' AND createdAt < cutoff`. On the `status`-only index
-- that is an index scan over all ~1.2k triaged rows which then filters every
-- one of them away: 340ms and 661 shared buffers to return nothing. The
-- composite answers it as a range scan, and being a prefix of it, still serves
-- the plain `status` lookups the single-column index was there for.
CREATE INDEX "lbc_product_listings_status_createdAt_idx" ON "lbc_product_listings"("status", "createdAt");
DROP INDEX "lbc_product_listings_status_idx";

-- Redundant with the unique index `lbc_product_listings_lbcId_key`, which is
-- the same btree on the same column. It only cost an extra write per insert
-- and 1.6 MB.
DROP INDEX "lbc_product_listings_lbcId_idx";

-- Never scanned since the counters were last reset, and nothing in the code
-- filters or orders on these columns -- they are written and read back as part
-- of a row, never used as a predicate.
DROP INDEX "lbc_product_listings_publishedAt_idx";
DROP INDEX "ai_analyses_bestMatchSource_idx";
DROP INDEX "listing_labels_label_idx";
