# Artcurial sold lots as photo references — design

**Date:** 2026-10-30
**Context:** The photo-references feature (spec of 2026-10-02) alerts the reseller
when a scraped ad shows a piece she uploaded as a reference. It has a handful of
references and has never fired. Artcurial publishes every lot it sold with
photos, a title, often the designer, and the hammer price. Those lots become
references: tens of thousands of expert-identified pieces with a real paid price.

## Intent

Catch the ad whose seller does not know what they have: a "fauteuil vintage" at
120 € that is the same model as a lot Artcurial hammered at 900 €. The bot
compares every new ad's photos against the Artcurial fund, asks Gemini to confirm
"same model", and emails immediately with the sold lot next to the ad.

Success: within a few weeks of running, the alert email surfaces ads that the
reseller confirms as the same model, at a false-alert rate low enough that she
keeps opening them.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| What the Artcurial data is for | References, exactly like the manually uploaded ones. Not an appraisal tool, not a price index (both noted as possible later layers). |
| When to alert | When the hammer price of the matching lot is at least 50 % above the ad's price (ratio 1.5, env-configurable). The email shows both prices so she judges lot by lot. |
| Which Artcurial sales | Sales whose specialties include DESIGN, ART_DECO, ITALIAN_DESIGN, FURNITURE_ART_OBJECTS or LIMITED_EDITION, from 2024 to today. Sold lots only. Hotel inventories (specialties INVENTORIES or HOTEL) excluded: hundreds of identical hotel chairs, no rarity, they would pollute similarity search. (My call.) |
| Where the lots live | Same `photo_references` / `reference_images` tables, tagged with a source, plus an `auction_lots` detail table. The matching stage, verifier and email plumbing are reused; manual references keep behaving as today. (My call.) |
| Several lots match one ad | One email per ad, closest lot first, the others below. (My call.) |
| Multi-piece lots | A lot "suite de dix chaises" at 1 700 € is 170 € per chair. The quantity is parsed from the title and the ratio compares the ad price to the per-unit hammer price. (My call.) |

## Spike findings (30 Oct 2026)

One Online sale (IT6064 "Intérieurs du 20e siècle", 311 sold lots) was ingested and
its cover photos embedded with the production embedding model, then compared with
the 27 000 listing photos already embedded in the database.

- Hammer prices: min 80 €, median 600 €, 40 % of lots under 500 €. The overlap with
  the 50–400 € ad window is real for Online sales; the big evening Design sales sit
  higher.
- Similarity: for a random listing cover, on average 0.01 of the 311 lots score
  ≥ 0.78 and 0.17 score ≥ 0.75. Scaled to ~15 000 lots: about one candidate per ad
  at the current `REFERENCE_MATCH_MIN_SIMILARITY` of 0.78, about ten at 0.75. The
  0.78 gate stays usable; the verifier budget is what bounds the cost.
- What ≥ 0.82 looks like: same object type, sometimes the same model. Verified by
  eye: Plia chair ad (80 €) vs Artcurial suite of ten Plia (1 700 €) — same model;
  Mategot perforated basket vs perforated magazine rack — same designer, different
  object; Wegner tripod table vs anonymous tripod table — same type only. The
  Gemini "same model?" confirmation is therefore essential, as in the original
  design.
- Designer: the lot payload carries a structured `artist` (full name, birth and
  death years) on about a third of lots; the rest name the designer nowhere or only
  in the description ("Édition E. Kold Christensen").

## Non-goals

- Exposing the auction data to the appraisal agent or to comp scoring.
- A designer / price index for triage.
- Text embeddings of lot descriptions (photo similarity plus keywords only).
- Unsold lots, hotel inventories, sales before 2024, other auction houses (the
  source column leaves room for them).
- Parsing the ad's quantity (an ad "lot de 8 lampes" is compared as one piece; the
  verifier sees the ad text and photos anyway).
- Backfilling the fund against ads scraped before ingestion.
- Re-ingesting a sale to pick up corrections after it was ingested once.

## Data model

One migration. `photo_references` gains:

- `source` text, not null, default `'MANUAL'`; values `MANUAL` | `ARTCURIAL`.
- Index on (`source`, `isActive`).

New table `auction_lots`, one row per auction reference, `referenceId` unique with
cascade delete:

- `house` text (`ARTCURIAL`), `saleRef` text, `lotRef` text (e.g. `278-a`), unique
  on (`house`, `saleRef`, `lotRef`) so re-running the ingest is idempotent.
- `lotUrl` text, `saleName` text, `soldAt` timestamp.
- `title` text, `artist` text nullable, `artistYears` text nullable, `description`
  text (HTML stripped, capped at ~2 000 chars).
- `estimateLowCents` int nullable, `estimateHighCents` int nullable,
  `hammerCents` int, `finalCents` int nullable (with fees).
- `quantity` int, default 1, parsed from the title; `hammerPerUnitCents` int
  (= hammer / quantity, rounded) so the gate is a plain column comparison.
- `createdAt`.

`reference_images.urlRemote` for an auction lot points at Artcurial's image proxy
(`https://www.artcurial.com/item-images/<blobName>?w=1024`, serves WebP ≤ 1024 px,
within the 3000 px limit of `fetch-image`). No Cloudinary copy: 30 000 photos
would cost more than the risk that Artcurial drops an image (the alert email then
shows a broken thumbnail and the lot link). An HNSW index on
`reference_images.embedding` (`vector_cosine_ops`) is created in the same
migration, in raw SQL like the existing vector columns.

Reference fields for an auction lot, filled at ingest:

- `name`: `<artist> — <title>` when there is an artist, else the title.
- `note`: the first ~400 chars of the description (materials, edition, dimensions),
  then "Adjugé <hammer> € le <date>, Artcurial <sale name>".
- `keywords`: the artist's full name lowercased (`enzo mari`), when present.
  Surnames alone would hit too much through the `ILIKE '%kw%'` substring match
  (`mari` in "mariage"). Nothing else: model names from titles are too often
  generic words. (My call.)
- `maxPriceCents`: null. The price gate for auction lots is the ratio (below).

## Ingestion CLI

`pnpm artcurial:ingest --year 2025 [--sale IT6064] [--limit 50] [--dry-run]`,
`src/cli/artcurial-ingest.ts`, run locally (hours, not a Vercel function).

1. Read `https://www.artcurial.com/sitemap/sales-<year>-fr.xml`; collect sale refs
   and lot URLs per sale.
2. Fetch each sale page `/ventes/<ref>`, parse the `__NUXT_DATA__` devalue array,
   keep sales whose `specialties[].specialty.ref` intersects the wanted set and
   contains neither INVENTORIES nor HOTEL. Skip internal test sales (refs such as
   `MA-6003`, sale 6226 "test"): a sale with fewer than 5 lots or whose name
   contains "test" case-insensitively. Print the kept sales before fetching lots.
3. For each lot URL of a kept sale: fetch the lot page, parse the lot object
   (`status`, `low`, `high`, `adjudicationPrice`, `finalPrice`, `adjudicationDate`,
   `artist.party.fullName`, `artist.yearOfBirth/yearOfDeath`,
   `pictures[].document.blobName`, `descriptions.FRENCH.{titleWithHtml,
   descriptionWithHtml}`). Skip unless `status === 'SOLD'` and
   `adjudicationPrice > 0`. Prices on the page are in euros, not cents.
4. Upsert reference + `auction_lots` row + up to 3 `reference_images`
   (catalogue order). Existing (`house`, `saleRef`, `lotRef`) → skip, so a run can
   be interrupted and restarted.
5. Embed the new images with the existing `GeminiImageEmbeddingService`
   (768 dims), 4 in flight, and store the vector. A failed embedding leaves the
   row NULL; the matching stage's per-run retry (20 per run) mops up stragglers.
   The CLI prints a final count of images left without embedding.
6. Politeness: a desktop User-Agent, 3 pages in flight, retry once on a 5xx or a
   network error, then record the lot URL as failed and continue. robots.txt
   allows these paths.

Expected volume: 2024–2026 ≈ 12 000 sold lots after exclusions, ≈ 30 000 photos,
≈ 3 h of page fetching and ≈ 6 h of embedding per full run; a single Online sale
takes minutes.

The devalue parsing (resolve indices into objects) is a small pure function with
a fixture test; the public JSON API of the site returns mock data and must not be
used.

## Matching stage changes

`RunReferenceMatchUseCase` keeps its flow; the repository and the price gate change.

- **Price gate.** `findCandidates` / `findRecentListingsCloseTo` return, per
  candidate, `source` and for auction lots `hammerPerUnitCents` plus the lot
  details needed by the email. The use case skips a manual reference when the ad
  price exceeds `maxPriceCents` (unchanged) and an auction lot when
  `priceCents * AUCTION_ALERT_RATIO > hammerPerUnitCents` (`AUCTION_ALERT_RATIO`
  env, default 1.5). The gate runs before the verifier so no Gemini call is spent
  on a lot that could not alert.
- **No per-reference backfill for auction lots.** `findReferencesToBackfill` only
  returns manual references. The ingest marks auction references as backfilled
  on creation. (Backfilling 15 000 lots against a week of ads would be thousands
  of verifier calls for ads mostly gone.)
- **Fund switch.** `AUCTION_REFERENCES_ENABLED` env (default true). When false the
  candidate queries ignore `source = 'ARTCURIAL'` without touching rows.
- **Verifier and spend.** The manual path keeps its Claude-first verifier. Auction
  candidates go to a Gemini-only verifier instance (same
  `GeminiReferenceMatchVerifier`, injected separately): at ~720 ads/day (last 7
  days of production) and about one candidate per ad, Claude vision would cost a
  few hundred dollars a month and trip the shared Claude spend limit that triage
  depends on. A daily cap `AUCTION_VERIFICATIONS_PER_DAY` (env, default 300)
  counts auction verifications across runs (a row count on `reference_matches`
  by source and day is enough); past it, auction candidates are left unjudged
  and the listing stays unchecked for a later run. (My call.)
- **Keywords for auction lots do not bypass the similarity gate.** Today a
  keyword hit alone qualifies a manual reference. An ad naming "Charlotte
  Perriand" would otherwise pull every Perriand lot of the fund into the three
  candidate slots regardless of the photo. For auction lots a candidate
  qualifies when similarity ≥ `REFERENCE_MATCH_MIN_SIMILARITY` (0.78), or when
  its keyword hits and similarity ≥ `REFERENCE_MATCH_WIDEN_SIMILARITY` (0.70);
  the keyword still ranks it first among qualified lots. Manual references keep
  the bypass. (My call.)
- **Manual references are never crowded out.** Manual candidates are always
  returned; `maxCandidatesPerListing` (3) applies to auction lots only. Two
  selections in the repository, merged by the use case, manual first. (My call.)
- **Budget.** Raise `maxVerificationsPerRun` from 20 to 40 so a 15-minute run
  covers its ~60 listings. With the fund in place nearly every ad clears the
  0.70 widen gate, so each ad gets all its photos embedded (up to 6) and the
  candidate query runs twice: accepted, embeddings are cheap and `maxRunMs`
  bounds a run.
- **Query shape.** The current candidate query cross-joins every active reference;
  with 15 000 references and 30 000 vectors it must use the HNSW index: first a
  kNN per listing image (`ORDER BY embedding <=> $vec LIMIT 50`), then group by
  reference, union with the keyword hits. Left to the builder, with the
  requirement that one `findCandidates` call stays under ~300 ms on the production
  database.
- **Email.** For an auction match, `EmailTemplates.referenceMatch` gets the lot
  details: subject `🔨 Vu chez Artcurial à <hammer> € : <ad title>`; body with the ad
  photo and the lot photo side by side, ad price, hammer price (and per-unit price
  when quantity > 1), sale name and date, link to the lot page, link to the ad,
  Gemini's reason, the existing 👍/👎 links. When several auction lots are confirmed
  for the same ad in one run, one email lists them all, closest first. The manual
  reference email is unchanged.
- **References page.** `/feedback/references` lists manual references only, and
  shows one line "Fonds Artcurial : N lots, M photos, actif/inactif".

## Evaluation CLI

`pnpm eval:auction-references --days 14 [--verify 30]`: replays the last N days of
listings whose cover is embedded against the fund, prints how many ads have at
least one candidate at 0.75 / 0.78 / 0.80 and how many pass the price gate, then
runs the verifier on a sample of the gated pairs and prints each verdict with
both image URLs. Used before deploying to check the threshold and the ratio on
real data, and again after a month. Follows the `eval-*-args.ts` + test pattern of
the existing evals.

## Testing

- Use case tests (fakes, Vitest): auction candidate above the ratio → skipped
  before the verifier; below → verified; confirmed auction match → one email
  with lot details; two confirmed lots for one ad → one email, closest first;
  manual reference path unchanged; fund disabled → no auction candidates;
  daily auction verification cap reached → auction candidates left unjudged,
  listing not marked checked, manual candidates still judged; auction keyword
  hit below the widen similarity → not a candidate; manual candidate still
  returned when three auction lots score higher.
- Quantity parser: "Paire de chauffeuses" → 2, "Suite de dix chaises" → 10,
  "Ensemble de trois cintres" → 3, "Deux cendriers" → 2, "Table basse" → 1,
  "Suite de 6 chaises" → 6.
- Devalue lot parser on a saved fixture page: artist, prices, pictures, status.
- Repository test against a local database with pgvector: candidate query returns
  the per-unit price and respects the source switch.
- Manual: ingest one Online sale, run the eval CLI, read the top pairs.

## Rollout

1. Migration (new columns, table, HNSW index) and the env vars in Vercel
   (`AUCTION_ALERT_RATIO`, `AUCTION_REFERENCES_ENABLED`,
   `AUCTION_VERIFICATIONS_PER_DAY`).
2. Ingest one Online sale locally; run the eval CLI; look at the verdicts.
3. Deploy; the stage already runs every 15 minutes and picks the fund up.
4. Ingest 2025 then 2024 and 2026 in the background over a night, resumable.
5. After two weeks: `reference_matches` by source (similarity distribution,
   confirmed rate, her votes on the alerts); adjust `AUCTION_ALERT_RATIO` and the
   similarity threshold.

## Left to the builder

- Exact devalue resolution and the sale/lot object detection heuristics (the
  spike script in the session scratchpad is a working reference, not code to copy).
- The kNN query rewrite and index parameters.
- French number-word parsing for quantities (un … vingt, digits).
- How the CLI reports progress and failures.
- Email layout for the multi-lot case.
