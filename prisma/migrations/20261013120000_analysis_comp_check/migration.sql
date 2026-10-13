-- Visual check of the priced comparables behind an estimate (see RunCompAnalysisUseCase.checkComps).
ALTER TABLE "ai_analyses" ADD COLUMN "compCheck" JSONB;
ALTER TABLE "ai_analyses" ADD COLUMN "confirmedCompCount" INTEGER;
