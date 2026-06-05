# LBC Bot — Funnel Rework Design

**Date:** 2026-06-05
**Status:** Draft for review

## 1. Context & problem

`lbc-bot` scrapes Leboncoin furniture/decor listings and tries to spot underpriced
"gems" (pieces a seller listed cheaply without realizing their resale value).

The original architecture made the AI the **judge**: it gated each listing on
"identify a designer from the photo with ≥80% confidence" (see `ESTIMATION_FLOW.md`).
Consequences:

- It only surfaced listings where the seller **already named** the valuable maker in
  the title — which means the piece was already correctly priced. Never a gem.
- Photo-only generic-title listings (the actual gems) were systematically `IGNORED`.

Root cause: naming an obscure designer/maker from a generic photo is precisely the
rare human skill we cannot replicate frontally — and the wrong thing to ask of the AI.

## 2. The reframe

The bot must be a **funnel**, not a judge:

| | Old (judge) | New (funnel) |
|---|---|---|
| Goal | Precision: decide what to buy | **Recall**: never miss a gem, cut volume |
| AI task | "Name the designer ≥80%" *(impossible)* | "Find visually similar pieces that **sold for X**" |
| Final decision | The AI | **The human expert** (wife) on a filtered feed |
| Moat over time | None | Proprietary dataset of her yes/no + real resale outcomes |

## 3. Validated hypothesis (de-risking spikes)

We validated, before writing any pipeline, that reverse-image search surfaces
high-value priced comps **from the photo alone, without naming a designer**.

- **Wrong tool:** Google Vision *Web Detection* — category-level, no prices. Discarded.
- **Right tool:** **Google Lens via SerpAPI** — returns visual product matches with
  prices and merchant sources.

Tested (`scripts/spike-lens-comps.ts`), 4/4 including the worst case:

| Photo | Result |
|---|---|
| 480px auction thumbnail | ✅ Willy Rizzo "Alveo", ~$7k |
| eBay catalog shot | ✅ Maison Charles "Lotus", ~$4k |
| Clean LBC isolated-object | ✅ Hans Kögl, ~$1.4k |
| **Cluttered in-situ LBC living room** | ✅ Edgar Brandt cobra lamp; 29 value-domain matches; $750–$12k |

Conclusion: the value IS detectable visually, even on messy real-world photos. The
remaining unknown is *recall on the worst photos* — a tuning issue, not a viability one.

## 4. Goals / non-goals

**Goals (MVP):**
- Turn the scrape → analyze flow into a budget-aware funnel that ends in a daily
  triage feed for the wife.
- Stay within SerpAPI free tier: **250 Lens calls/month (~8/day)**.
- Each Lens call spent on a high-probability candidate (precise pre-filter).
- Capture her 👍/👎 to improve the pre-filter over time.

**Non-goals (out of scope for this iteration):**
- Production scaling / paid SerpAPI tier.
- Self-hosted visual-embedding comp database (the long-term moat — later).
- OpenAI-embeddings RAG learning loop (optional, deferred).
- Logistics, inventory, resale automation.

## 5. Architecture — the funnel as the existing status machine

```
new ──(A. text+price rules, 0€)──►  rejected
                              └────►  prefiltered
prefiltered ──(B. Gemini Flash triage, ~0€)──►  triaged { score 0–10 }
   ⤷ daily job: take top-N `triaged` within the remaining Lens budget (≤8/day, ≤250/mo)
triaged ──(C. Lens via SerpAPI)──►  analyzed { AiAnalysis from comps }   or   ignored
analyzed ──►  wife's FEED  ──►  👍/👎 (ListingFeedback)  ──►  re-tunes A & B
```

Non-Lensed `triaged` listings stay queued and are re-ranked the next day. The Lens
budget guard makes accidental SerpAPI overspend impossible.

## 6. Reuse vs rebuild

| Existing | Disposition |
|---|---|
| `LbcProductListing` + status machine | **Keep**, add statuses (`prefiltered`, `triaged`) |
| `ListingImage`, `Search`, `Category`, `Notification`, `ListingLabel` | **Keep as-is** |
| `ListingFeedback` (👍/👎 + `embeddingText`) | **Keep** — the learning loop |
| `LeBonCoinListingScraper` (Playwright) | **Keep** |
| Next.js frontend + feedback buttons | **Keep** → becomes the triage feed |
| `AiAnalysis` table | **Keep schema**, change how it is populated (Lens comps, not designer search) |
| `RunAiAnalysisUseCase` | **Rewrite** — the core valuation engine |
| Partner scrapers (Auction.fr, Pamono, 1stDibs) + designer gate | **Remove** — Lens replaces them |
| `IPriceEstimationService` (+ OpenAI/Gemini estimation impls) | **Retire from valuation**; replaced by `ITriageService` + `ICompService` |

## 7. The three stages

### A. Rules pre-filter (`ITextFilterService`, 0€)
Cheap signals on raw listing data:
- In a target category; asking price below a category threshold.
- **Generic title** (no known maker named = good — gem profile).
- Positive signal words (`laiton, doré, vintage, années 70, rotin, travertin, chrome,
  laque, …`); negative words (`ikea, conforama, neuf, …`).
- Produces a coarse score; non-rejected listings become `prefiltered`.

Repurposes the old text logic — no longer to *judge value*, only to decide
"worth spending downstream compute on".

### B. Gemini Flash triage (`ITriageService`, ~0€)
Single consistent scorer (ranking requires comparable scores):
- Prompt: "Does this look like a vintage/design decorative piece that could be
  valuable? Rate 0–10 the worth-investigating signal. Do NOT name a designer."
- **Gemini Flash primary** (free tier, key provisioned). **OpenAI as fallback** on
  error/rate-limit only — never random (random providers break score comparability).
- Output: `triaged` with a 0–10 score used to rank for the Lens budget.
- Optional later: a calibration A/B (score the same listings with both providers,
  compare against ≥~50 of the wife's 👍/👎, keep the winner).

### C. Lens comps (`ICompService`, SerpAPI — the budgeted step)
Productizes `scripts/spike-lens-comps.ts`:
- Input: the listing's best photo (public URL). Output: visual matches.
- Keep matches that are **on a value domain AND carry an extracted price**.
- Persist results into `AiAnalysis`.

## 8. Scoring

From the value-domain priced comps for a listing:
- **Headline estimate = median** of those comp prices.
- **Range = min–max** shown alongside (so the wife sees dispersion).
- **Margin** = median − asking price (`marginCents`).
- **Confidence by count of priced value-comps:**
  - ≥3 → reliable
  - 1–2 → "to verify"
  - 0 → keep as "identified, estimate manually" (no price shown, still surfaced)

Storage: `estMinCents`/`estMaxCents` = range; median + confidence in `AiAnalysis`
(`description` / a small added field); `bestMatchSource` = top value comp URL.

## 9. Budget guard (free-tier safety)
A usage counter (e.g. a `LensUsage` table or daily/monthly tally) caps Lens calls at
**8/day and 250/month**. The daily job stops at the cap; remaining candidates wait in
the queue and are re-ranked next day. No accidental SerpAPI overspend.

## 10. Triage feed & learning loop
- Reuse the existing Next.js listing view + 👍/👎 buttons.
- The wife reviews ~the day's analyzed candidates (sorted by margin/confidence) in a
  few minutes, swiping yes/no.
- Each 👍/👎 (with the listing's features) feeds back to tune stages A & B over time.
- Real resale outcomes (later) become the proprietary value dataset / long-term moat.

## 11. Cost
- Scrape: free (self-hosted Playwright).
- Stage A: free.
- Stage B: Gemini Flash free tier (hundreds/day fit; OpenAI fallback only).
- Stage C: SerpAPI free tier, 250/month — the binding constraint, hard-capped.
- Net target: **~0 €/month** for the validation phase.

## 12. Risks & open questions
- **Recall on truly bad photos** — mitigations: object-detection crop before Lens;
  accept partial recall (a missed gem just stays in the firehose).
- **Price coverage** — only ~15–20% of Lens matches carry an extracted price; the
  value-domain + priced filter may leave few comps. Fallback: confidence tiers (§8);
  later, scrape the matched comp page for a price.
- **LBC anti-bot (DataDome)** — scraper resilience already a concern in the existing
  code; out of scope to redesign here but a known operational risk.
- **8/day is small** — accepted for validation; the pre-filter precision is what makes
  those 8 count.

## 13. Provisioned during design
- GCP personal project `lbc-bot` (gcloud config `perso`): Cloud Vision API enabled,
  service account key at `google.json` (gitignored).
- `SERPAPI_KEY` in `.env` (free tier, 250/month).
- New Gemini API key in `.env` (old one was dead).
