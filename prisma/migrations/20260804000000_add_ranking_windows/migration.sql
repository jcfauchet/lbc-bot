-- Marks that the comparative ranker was already consulted for a given accrual
-- window (see windowEntitlement/currentWindowKey), so analyze-and-notify's
-- 15-minute cadence does not re-rank the same window's shortlist on every tick.
CREATE TABLE "ranking_windows" (
    "id" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_windows_windowKey_key" ON "ranking_windows"("windowKey");
