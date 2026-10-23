-- One row per search attempted by the scrape cron, to measure DataDome blocking by hour and search.
CREATE TABLE "scrape_attempts" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "newListings" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scrape_attempts_createdAt_idx" ON "scrape_attempts"("createdAt");

-- One row per appraisal agent run, kept even when the listing ends up ignored, for cost and zero-comp rates.
CREATE TABLE "appraisal_runs" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "compCount" INTEGER NOT NULL,
    "turns" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appraisal_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appraisal_runs_createdAt_idx" ON "appraisal_runs"("createdAt");
