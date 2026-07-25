# Precision fixes from feedback analysis — design

**Date:** 2026-07-25
**Context:** Analysis of 237 qualified feedbacks + Vercel logs.

## Problem

The current live comp-based system (`serpapi-google-lens`, since 6 Jun 2026) has
**10% precision** on qualified feedback, and *every* feedback on it falls in the
"predicted margin ≥200€" bucket. Root cause, confirmed verbatim by operator
comments ("хватит придумывать цифры", "estimation trop vaste"): a lone luxury comp
(1stdibs/Chairish/Pamono) inflates the median/max, producing phantom high margins.
Retroactive backtest on the 237 feedbacks: suppressing predicted margin ≥200€ lifts
precision 22%→33% while keeping 83% of true positives; requiring a conservative
margin AND a tight estimate band gives a principled 28% without a hard cap.

Two secondary issues:
- `/api/cron/analyze-and-notify` times out at 300s (code says `// Should be 800`);
  on timeout the last stage (`notify`) is skipped.
- Professional sellers leave no margin (operator: "продает профессионал, нельзя
  сделать маржу"), but the pro/particulier badge is not scraped.

Dropped: the earlier "switch comps to Gemini" idea — Gemini was the *old* direct
estimation approach; there is no Gemini comp provider. SerpAPI-Lens is the only one.

## Changes

### 1. Robust estimator + conservative notify gate (core)
- `comp-scoring.ts`: when ≥4 priced comps, **drop the single highest comp** before
  computing median / P25 / P75. A lone luxury outlier can no longer inflate the
  estimate. Tighten `MAX_RELIABLE_IQR_RATIO` 1 → 0.75 so wider disagreement demotes
  to `to_verify` (already excluded from email by the confidence gate).
- `RunNotificationUseCase`: gate the email decision on a **conservative margin**
  = `estMin − price` (worst-case-still-profitable), not the median margin. The
  displayed `marginCents` stays median-based (informative). New constructor param
  `minConservativeMarginCents`, wired from `MIN_MARGIN_IN_EUR`.
- Pure functions get unit tests (TDD); the gate gets a use-case test.

### 2. Cron timeout
- `maxDuration` 300 → 800 on `analyze-and-notify` (and `scrape`, same logged 504).
  Caveat: effective only if the Vercel plan allows 800s; otherwise Vercel clamps.

### 3. Professional-seller detection — DROPPED (already covered)
Investigation found `LeBonCoinApiClient.ts:229` already hard-excludes pros at
ingestion (`ad.professional_ad || ad.owner.type === 'pro'`), shipped 6 Dec 2025 —
before all the analysed feedback. A pro listing never reaches the DB via the
primary (API) path, so a `sellerType` pipeline would be redundant. The residual
operator "sold by a professional" complaints (~2-3 of 62 negatives) are semi-pros
registered as *particulier* that the official flag cannot catch; detecting those
needs heuristics (store name, seller listing volume, description cues), which is a
separate, larger effort with marginal payoff. Deferred by decision on 2026-07-25.

## Non-goals
- No hard cap on predicted margin (overfit to a biased sample).
- No new comp provider.
- Re-scoring the historical estimator offline (raw comps are not stored).
- No semi-pro/dealer heuristic detection (see §3).

## Validation
- `pnpm test` (unit + use-case).
- Backtest reference (already run): conservative-margin + tight-range ≈ 28% vs 22%.
- Post-deploy: operator must qualify `/feedback/inbox` to measure the live lift.
