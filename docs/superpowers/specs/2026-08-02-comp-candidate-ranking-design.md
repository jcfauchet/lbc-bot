# Comparative ranking of comp candidates — design

**Date:** 2026-08-02
**Context:** Funnel measurements taken from the production database on 2 Aug 2026,
plus the 30 Jul feedback batch.

## Problem

Scraping volume grew ~40x in July (52 listings the week of 6 Jul, 1839 the week of
27 Jul) while the comp budget stayed at 6/day + 2 fast-track. The funnel now looks
like this:

| Week | Scraped | Triage ≥ 8 | Comped | Notified |
|---|---|---|---|---|
| 27 Jul | 1839 | 697 | 32 | 12 |
| 20 Jul | 2459 | 954 | 54 | 29 |
| 13 Jul | 348 | 183 | 48 | 16 |
| 6 Jul | 52 | 52 | 52 | 22 |

We qualify ~700 candidates a week and can value ~50. **Which 50 is now the dominant
lever on precision**, and today that choice is close to arbitrary:

1. **The triage score does not discriminate at the top.** Over the two weeks to
   2 Aug: 57 listings at score 10, **967 at score 9**, 627 at 8. The candidate sort
   in `RunCompAnalysisUseCase` is fast-track, then score, then freshness — with 967
   ties at 9, freshness is the de facto sole criterion.
2. **Spending is greedy against a midnight reset.** `analyze-and-notify` runs every
   15 minutes and `startOfDay()` resets the budget at midnight, so the day's credits
   are consumed by the first runs after 00:00, on whatever happened to be in the
   pool. The real selection rule is "whoever was there at 00:15", not even "the
   freshest".

Absolute 0–10 scoring saturates because each listing is judged alone, against no
reference. Comparative judgement — "which of these 20 is the safest bet" — is far
better calibrated for an LLM and is the mechanism this design introduces.

## Objective

Maximise **precision** — the certainty that a piece is genuinely vintage/sought
after — not predicted margin. Feedback repeatedly shows that the largest predicted
margins are estimation artefacts (30 Jul: green marble table, predicted margin
2829 €, rejected), and the operator's own rejections read "nobody buys this" or
"price too high for resale".

## Design

### New port: `ISelectionRanker`

`src/domain/services/ISelectionRanker.ts`, sitting alongside `ITriageService`:

```ts
export interface RankingCandidate {
  listingId: string
  imageUrl: string
  title: string
  priceEur: number
  description?: string
}

export interface RankedPick {
  listingId: string
  rank: number
  /** The ranker judged this piece worth spending a scarce comp credit on. */
  worthCredit: boolean
  reason?: string
}

export interface ISelectionRanker {
  readonly providerName: string
  rank(candidates: RankingCandidate[], guidance?: string | null): Promise<RankedPick[]>
}
```

Implemented by `GeminiSelectionRanker` (`src/infrastructure/ai/Gemini/`) as a single
multi-image call. Prompt construction and response parsing live in a pure module,
`src/infrastructure/ai/ranking-prompt.ts` exposing `buildRankingPrompt` and
`parseRanking`, mirroring the `triage-prompt.ts` split so both stay testable without
network access.

The learned `TriageGuidance` is injected into the ranking prompt: lessons distilled
from past feedback apply as much to tie-breaking as to scoring. Guidance is
truncated with the same cap as triage (2000 chars).

The ranker is an **optional constructor dependency** of `RunCompAnalysisUseCase`,
like `feedbackRepository` and `availabilityService`. Unwired, the use case keeps its
current behaviour — which keeps both paths testable and makes the feature
switchable off by configuration.

### Windowed budget allocation

Per-window entitlement replaces the current daily + fast-track computation:

```
entitlement = floor(dailyBudget × windowsElapsedToday / windowsPerDay) − usedToday
```

`windowsElapsedToday` is the 1-based index of the window the run falls into, so the
first window of the day already carries an entitlement. With `dailyBudget=8` and
`windowsPerDay=4` (6-hour windows): 2 credits at 00:00,
4 cumulative at 06:00, 6 at 12:00, 8 at 18:00. Carry-over is implicit — an abstaining
window leaves `usedToday` untouched, so the next window's entitlement absorbs it.
The monthly cap (`LENS_MONTHLY_BUDGET`, 250) still bounds everything.

`analyze-and-notify` keeps its 15-minute schedule; runs inside a window whose
entitlement is already spent simply do nothing at the comp stage.

### Execution flow

`RunCompAnalysisUseCase.execute()` becomes:

1. Expire listings older than `TRIAGED_MAX_AGE_DAYS` — unchanged.
2. Compute the current window's entitlement; return early when it is ≤ 0.
3. Load `TRIAGED` listings and apply the existing **free** filters: replica signal,
   designer already named by the seller, no image, near-duplicate of a past negative
   feedback.
4. Build the shortlist: sort by score then freshness, cap at `RANKING_SHORTLIST_SIZE`.
5. Call the ranker; receive an ordered list with `worthCredit`.
6. Walk the picks in rank order: availability probe, then spend a credit, run comps,
   estimate, notify — unchanged downstream.
7. Unpicked candidates stay `TRIAGED` and are reconsidered next window, until the
   7-day expiry drops them.

Two deliberate moves relative to today's order:

- The free filters run **before** the ranker, so shortlist slots are not wasted and
  the model is not shown known junk.
- The availability probe runs **after** the ranker, on picks only. It is one HTTP
  request per listing; there is no reason to pay it for 20 candidates when 2 will be
  served.

### Fast-track removal

The fast-track lane is deleted and its 2 bonus credits folded into the base budget
(`LENS_DAILY_BUDGET` 6 → 8, unchanged capacity). It existed so a fresh find would not
wait for the midnight reset; with 6-hour windows the worst-case wait is 6 hours, and
its trigger (score ≥ 8, under 24h old) matched nearly the whole flow anyway. This
removes `FAST_TRACK_DAILY_EXTRA`, `FAST_TRACK_MIN_SCORE` and `FAST_TRACK_FRESH_HOURS`.

## Error handling

The ranker must never jam the funnel — same principle as the per-stage isolation in
`analyze-and-notify`.

| Incident | Behaviour |
|---|---|
| Ranker throws (429, timeout, bad key) | Fall back to the deterministic order (score, then freshness) and spend the window entitlement. Selection quality is lost, flow is not. |
| Malformed or unparseable JSON | `parseRanking` returns an empty list; same fallback. |
| Unknown or duplicate `listingId` returned | Silently ignored; only ids from the submitted shortlist are honoured. |
| Fewer picks than the entitlement | Intended abstention: spend less, carry the rest over. |
| Every `worthCredit` false | Spend nothing, full carry-over to the next window. |
| One image unreachable | Drop that candidate from the call rather than failing the batch. |

Each fallback logs via `logError`. Repeated fallbacks across consecutive windows mean
we are ranking blind, and the logs are the signal; no additional alerting mechanism
is introduced.

`execute()` returns `{ processed, analyzed, ignored, expired, deferred }` — `deferred`
counting credits left unspent by abstention, so an over-severe ranker is visible in
the cron response without querying the database.

## Testing

Vitest, matching existing conventions.

`src/infrastructure/ai/ranking-prompt.test.ts`:
- parses a well-formed response into ordered picks
- returns an empty list on truncated or non-JSON output
- drops unknown ids and out-of-range ranks
- truncates injected guidance at the cap

`src/application/use-cases/RunCompAnalysisUseCase.test.ts` additions:
- window entitlement maths, including carry-over from an abstaining window
- monthly cap still takes precedence over window entitlement
- total abstention spends no credit and reports `deferred`
- ranker failure falls back to the deterministic order
- picks are processed in rank order
- availability probe is called only for picks
- free filters run before the shortlist is built

Removed: the three fast-track tests. Rewritten: `stops at the remaining daily budget`
becomes its windowed equivalent.

## Configuration

Added to `src/infrastructure/config/env.ts`:

- `RANKING_ENABLED` — default `true`. Set to `false`, the windowed budget still
  applies but the ranker is never called: candidates are served in the deterministic
  order, i.e. the fallback path. It is a kill switch for the model call, not a revert
  to the midnight-reset behaviour.
- `RANKING_WINDOWS_PER_DAY` — default `4`
- `RANKING_SHORTLIST_SIZE` — default `20`

Changed: `LENS_DAILY_BUDGET` 6 → 8.
Removed: `FAST_TRACK_DAILY_EXTRA`, `FAST_TRACK_MIN_SCORE`, `FAST_TRACK_FRESH_HOURS`.

## Out of scope

- Re-calibrating the triage score itself. The score stays a scope gate; ranking is
  what discriminates at the top.
- Raising the comp budget. That is a cost decision, independent of this change.
- Vector pre-filtering of the shortlist against positive feedback. Only 55 positive
  labels exist today — too thin to cut candidates before the model sees them. Worth
  revisiting if shortlist volume outgrows a single call.
