-- Stable hash of the feedback a guidance was distilled from, so the daily
-- learning routine can detect "nothing actually changed" even when the item
-- count is unchanged (e.g. a comment was edited) and skip a redundant LLM call.
ALTER TABLE "triage_guidance" ADD COLUMN "contentHash" TEXT;
