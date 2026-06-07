-- CreateTable
CREATE TABLE "triage_guidance" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceFeedbackCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triage_guidance_createdAt_idx" ON "triage_guidance"("createdAt");
