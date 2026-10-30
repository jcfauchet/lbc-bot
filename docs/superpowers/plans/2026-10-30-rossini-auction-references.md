# Rossini Auction References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Rossini as a second auction house in the photo-reference fund, through a house-agnostic ingester driven by per-house adapters, with the fund's `source` generalised from `ARTCURIAL` to `AUCTION`.

**Architecture:** `src/infrastructure/auction/` holds what is shared (`AuctionIngester`, `HouseAdapter`, `quantity`); `src/infrastructure/artcurial/` keeps its parsers and gains `ArtcurialAdapter`; `src/infrastructure/rossini/` holds the Rossini parsers, fixtures and `RossiniAdapter`. The matching stage, repository, email and cron read the house from `auction_lots.house`; the CLI and cron take a house.

**Tech Stack:** Next.js 16, Prisma 7 (raw SQL for pgvector), Gemini Embedding 2, Vitest, tsx CLIs.

**Spec:** `docs/superpowers/specs/2026-10-30-rossini-auction-references-design.md` (and the Artcurial spec it extends).

## Global Constraints

- All code, identifiers and comments in English; French only in user-facing email and page copy.
- Commit messages in English, plain, no `Co-Authored-By` lines.
- Only Rossini's server-rendered pages are fetched (`/resultats?year=`, `/catalogue/<id>?lang=fr&search=&offset=<n>&max=50`, `/lot/<saleId>/<lotId>`) and the Drouot CDN `full` photos; `/recherche/*` is never requested.
- The fund stays Gemini-only for verification; nothing in this plan touches the verifiers.
- After Task 1 every query, filter and template that distinguishes manual from auction references uses `source <> 'MANUAL'` (or the literal `'AUCTION'` when writing); the literal `'ARTCURIAL'` survives only as a `house` value.
- Repository tests mock `PrismaClient`; parsers are tested on captured fixtures; the ingester on fakes.
- Sandbox note for implementers: `npx` and `git` are refused in the worktree; use `node_modules/.bin/*`, leave files uncommitted and list them.

## Review Focus

1. A Rossini lot whose result line is absent, "Non vendu", or `0 EUR` must never be stored (Task 3).
2. A lot page whose `phare` hashes include another sale's id (banner, related lot) must keep only its own sale's hashes (Task 3).
3. The year page date "mercredi 31 décembre 2025 à 14h00" must parse to an ISO date; an unparseable date skips the sale in the cron window but not in the CLI (Tasks 3, 5).
4. After the rename, an auction reference with `source = 'AUCTION'` and a manual one with `'MANUAL'` must still be gated, verified and emailed exactly as before (Task 1).
5. The cron must give Rossini a budget even when Artcurial used its whole share (Task 5).

---

### Task 1: Generalise `ARTCURIAL` into `AUCTION`

**Files:**
- Create: `prisma/migrations/20261031090000_auction_source/migration.sql`
- Modify: `prisma/schema.prisma` (comment on `source`), `src/domain/repositories/IReferenceRepository.ts`, `src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts` (+ test), `src/application/use-cases/RunReferenceMatchUseCase.ts` (+ test), `src/infrastructure/mail/EmailTemplates.ts` (+ test), `src/cli/eval-auction-references.ts`, `src/app/api/references/fund/route.ts` (+ test), `src/app/feedback/references/page.tsx`

**Interfaces:**
- Produces: `ReferenceSource = 'MANUAL' | 'AUCTION'`; `AuctionHouse = 'ARTCURIAL' | 'ROSSINI'` (domain, `src/domain/repositories/IReferenceRepository.ts`) with `AuctionLotSummary.house: AuctionHouse`; `AuctionFundStats { lots: number; images: number; embedded: number; byHouse: Array<{ house: AuctionHouse; lots: number }> }`; `findExistingLotRefs(house: AuctionHouse, saleRef)`; `createAuctionLot` writes `source: 'AUCTION'`; `HOUSE_LABELS: Record<AuctionHouse, string> = { ARTCURIAL: 'Artcurial', ROSSINI: 'Rossini' }` exported from `src/domain/auction-houses.ts`; `EmailTemplates.auctionMatch` renders `🔨 Vu chez <label>` and `Lot <label>` from the best alert's `auction.house`; fund route returns `byHouse`; page line `Fonds enchères : N lots (Artcurial 4 909, Rossini 0), M photos, actif`.

- [ ] **Step 1: Write the failing tests**
  - Repository: `createAuctionLot` writes `source: 'AUCTION'`; the auction candidate query text contains `"source" <> 'MANUAL'` and not `'ARTCURIAL'` (assert on the SQL strings passed to `$queryRaw`); `auctionFundStats` returns `byHouse` from a `groupBy` mock; `countAuctionVerificationsSince` SQL uses `<> 'MANUAL'`.
  - Use case: existing auction tests pass with `source: 'AUCTION'` in the helpers; one test asserts a candidate with `source: 'AUCTION'` and `auction.house: 'ROSSINI'` is verified by the auction verifier.
  - Template: `auctionMatch` with `house: 'ROSSINI'` → subject starts `🔨 Vu chez Rossini à`, html contains `Lot Rossini`; with `house: 'ARTCURIAL'` unchanged.
  - Fund route: body has `byHouse`.
- [ ] **Step 2: Run them to verify they fail** — `node_modules/.bin/vitest --run src/infrastructure/prisma/repositories/PrismaReferenceRepository.test.ts src/application/use-cases/RunReferenceMatchUseCase.test.ts src/infrastructure/mail/EmailTemplates.test.ts src/app/api/references/fund` → FAIL.
- [ ] **Step 3: Migration** — `UPDATE "photo_references" SET "source" = 'AUCTION' WHERE "source" = 'ARTCURIAL';` with a comment; schema comment updated.
- [ ] **Step 4: Implement** — replace every `'ARTCURIAL'` source comparison by `<> 'MANUAL'` (reads) or `'AUCTION'` (writes/select literals); `findRecentListingsCloseTo`/`findReferencesToBackfill` keep `= 'MANUAL'`; `auctionFundStats` adds `prisma.auctionLot.groupBy({ by: ['house'], _count: true })`; email and page as in Interfaces; eval CLI filters `c.source !== 'MANUAL'` and prints the house in each verify line.
- [ ] **Step 5: Whole suite + tsc** — `node_modules/.bin/vitest --run && node_modules/.bin/tsc --noEmit` → PASS. Grep check: `grep -rn "'ARTCURIAL'" src` only matches `house` usages.
- [ ] **Step 6: Commit** — `feat(references): generalise the auction fund source and show the house in alerts`

---

### Task 2: House adapters and the shared ingester

**Files:**
- Create: `src/infrastructure/auction/HouseAdapter.ts`, `src/infrastructure/auction/AuctionIngester.ts`, `src/infrastructure/auction/AuctionIngester.test.ts`, `src/infrastructure/auction/quantity.ts` (+ test, moved from `artcurial/`), `src/infrastructure/artcurial/ArtcurialAdapter.ts` (+ test)
- Delete: `src/infrastructure/artcurial/ArtcurialIngester.ts` (+ test), `src/infrastructure/artcurial/quantity.ts` (+ test)
- Modify: `src/infrastructure/artcurial/to-auction-reference.ts` (import of `parseQuantity`), `src/infrastructure/di/container.ts`, `src/cli/artcurial-ingest.ts`, `src/app/api/cron/artcurial-ingest/route.ts` (+ test, import paths only)

**Interfaces:**
- Produces (`HouseAdapter.ts`):

```ts
export interface HouseSale {
  ref: string                 // saleRef stored in auction_lots
  name: string
  /** ISO date of the day results are final (end date for an online sale). */
  closedAt: string | null
  /** False while the house still shows the sale as running. */
  finished: boolean
  totalLots: number
}
export interface HouseAdapter {
  readonly house: AuctionHouse
  listSales(year: number): Promise<HouseSale[]>
  listLotUrls(sale: HouseSale): Promise<string[]>
  lotRefFromUrl(url: string): string
  /** Null when the page parses but the lot was not sold; throws on fetch/parse failure. */
  fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null>
}
```
`AuctionIngester(adapter, repo, embedder, log, now?)` with `ingest(options)` where `IngestOptions`/`IngestReport` keep their fields and the report gains `house: AuctionHouse`. Behaviour is the current `ArtcurialIngester.ingest` with the house-specific calls routed through the adapter: `listSales` replaces sitemap + sale page (the Artcurial adapter fetches the sitemap once and the sale pages lazily per sale ref, applying `isWantedSale`); `closedBetween` uses `sale.finished` and `sale.closedAt`; `findExistingLotRefs(adapter.house, sale.ref)`; `fetchLot` replaces `parseLotPage` + `toAuctionReference` (a null result counts as `lotsSkippedUnsold`; a throw as `lotsFailed`).
- `ArtcurialAdapter(fetcher)` implements it with the existing parsers; `listSales(year)` returns one `HouseSale` per wanted sale of the sitemap (`closedAt = endDate ?? beginDate`, `finished = status === 'FINISHED'`), and caches the sitemap's lot URLs for `listLotUrls`.

- [ ] **Step 1: Move the ingester tests** to `AuctionIngester.test.ts` against a fake adapter (same cases: window, budget, existing skip, failures, limit, dry run), plus `ArtcurialAdapter.test.ts` on the existing fixtures (one wanted sale listed with the right `closedAt`/`finished`, lot URLs grouped, `fetchLot` returns the PK9 lot's `NewAuctionLot`, null for an unsold page).
- [ ] **Step 2: Run to verify they fail** (modules missing).
- [ ] **Step 3: Implement** the adapter, the shared ingester (copy the loop, swap the calls), delete the old files, fix imports (`container.artcurialIngester = new AuctionIngester(new ArtcurialAdapter(fetcher), …)`).
- [ ] **Step 4: Whole suite + tsc** → PASS; the CLI and cron behave as before.
- [ ] **Step 5: Commit** — `refactor(auction): house adapters behind a shared ingester`

---

### Task 3: Rossini parsers

**Files:**
- Create: `src/infrastructure/rossini/types.ts`, `parse-year-page.ts`, `parse-catalogue-page.ts`, `parse-lot-page.ts`, `french-date.ts`, `is-wanted-sale.ts`, `parsers.test.ts`, fixtures `__fixtures__/year-2025.html`, `__fixtures__/catalogue-186362-p1.html`, `__fixtures__/catalogue-186362-p2.html` (offset 50), `__fixtures__/lot-180689-34122319.html`

**Interfaces:**

```ts
export interface RossiniSale { id: string; title: string; date: string | null /* ISO */; catalogueUrl: string }
export interface RossiniLot {
  saleId: string; lotId: string; lotNumber: string; title: string; description: string
  estimateLowEur: number | null; estimateHighEur: number | null
  resultEur: number | null            // hammer, "Résultats sans frais"; null when not sold
  photoHashes: string[]               // from cdn.drouot.com/d/lot/(phare|small)/62/<saleId>/<hash>, own sale only, deduplicated
}
export function parseYearPage(html: string): RossiniSale[]
export function parseCataloguePage(html: string): { lotUrls: string[]; total: number }   // "Lots 1 à 50 sur 138" → total 138
export function parseLotPage(html: string): RossiniLot | null
export function parseFrenchDate(line: string): string | null   // "mercredi 31 décembre 2025 à 14h00" → "2025-12-31"
export const ROSSINI_HOUSE_ID = '62'
export function isWantedSale(sale: { title: string; totalLots?: number }): boolean   // keyword rule of the spec + "< 5 lots → false" when totalLots is known
```

- [ ] **Step 1: Capture the fixtures** with curl and the desktop UA: `https://www.rossini.fr/resultats?year=2025`, `https://www.rossini.fr/catalogue/186362?lang=fr&search=&offset=0&max=50`, the same with `offset=50`, `https://www.rossini.fr/lot/180689/34122319`.
- [ ] **Step 2: Write the failing tests** — year page: 77 sales, the sale `174947` titled "Numismatique, Bijoux, Horlogerie et Luxe" dated `2025-12-31`; catalogue p1: 50 lot URLs of the form `/lot/186362/<lotId>`, total 138; p2: 50 more, none in common; lot page: `saleId '180689'`, `lotId '34122319'`, `lotNumber '72'`, title starting `RODIN Auguste`, `estimateLowEur 300000`, `estimateHighEur 500000`, `resultEur 555000`, 6 photo hashes; `parseLotPage` on a page with `Résultat` removed → `resultEur null`; `parseFrenchDate` table incl. an unparseable line → null; `isWantedSale` table: "Mobilier & Objets d'art" true, "Intérieurs modernes & contemporains" true, "Livres, Timbres, Mobilier, Objets d'Art & Arts de la Table" true, "Numismatique, Bijoux & Montres" false, "Affiches, Lithographies & Œuvres papier" false, "Art Moderne & Intérieurs contemporains" true, `{ title: 'Mobilier', totalLots: 3 }` false.
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement** with string scanning/regexes (no new dependency); numbers strip spaces and non-breaking spaces.
- [ ] **Step 5: Run green, whole suite, commit** — `feat(rossini): parse year, catalogue and lot pages`

---

### Task 4: Rossini adapter

**Files:**
- Create: `src/infrastructure/rossini/RossiniAdapter.ts` (+ test), `src/infrastructure/rossini/to-auction-reference.ts` (+ test)

**Interfaces:**
- `toAuctionReference(lot: RossiniLot, sale: RossiniSale): NewAuctionLot | null` — null unless `resultEur > 0`; `name` = title; `keywords: []`; `imageUrls` = `https://cdn.drouot.com/d/lot/full/62/<saleId>/<hash>`; `lot.house 'ROSSINI'`, `saleRef = sale.id`, `lotRef = lot.lotId`, `lotUrl = https://www.rossini.fr/lot/<saleId>/<lotId>`, `saleName = sale.title`, `soldAt = new Date(sale.date)` (null date → skip the lot, return null), `artist null`, `quantity = max(1, parseQuantity(title))`, cents = `Math.round(eur × 100)`, `note` = first 400 chars of the description then `Adjugé <hammer> € le <dd/mm/yyyy>, Rossini <sale title>`.
- `RossiniAdapter(fetcher)`: `listSales(year)` → year page → wanted sales as `HouseSale { ref: id, name: title, closedAt: date, finished: date !== null && date <= today, totalLots: 0 }` (the count is unknown until the catalogue is read; the "< 5 lots" rule is applied in `listLotUrls` by returning `[]` when the catalogue total is under 5); `listLotUrls(sale)` pages the catalogue with `offset` until `total`; `lotRefFromUrl` = last path segment; `fetchLot` = lot page → `toAuctionReference`.

- [ ] **Step 1: Failing tests** with a fake fetcher serving the fixtures: `listSales(2025)` returns the wanted sales only; `listLotUrls` fetches offsets 0, 50, 100 for a total of 138 and returns 138 URLs; `fetchLot` of the RODIN lot returns the summary with 6 `full` photo URLs and `hammerCents 55500000`; a lot without result → null.
- [ ] **Step 2: Run red, implement, run green, whole suite + tsc, commit** — `feat(rossini): house adapter producing auction references`

---

### Task 5: Wiring: CLI `--house`, cron over both houses, eval `--house`

**Files:**
- Modify: `src/cli/artcurial-ingest.ts` (rename to `src/cli/auction-ingest.ts`, keep the `artcurial:ingest` script and add `auction:ingest`), `src/cli/artcurial-ingest-args.ts` → `auction-ingest-args.ts` (+ test), `src/infrastructure/di/container.ts`, `src/app/api/cron/artcurial-ingest/route.ts` (+ test; path unchanged), `src/cli/eval-auction-references.ts` + args (+ test)

**Interfaces:**
- Args: `--house artcurial|rossini` (default `artcurial`), `IngestOptions.house: AuctionHouse` removed from options; instead the CLI picks `container.auctionIngesters[house]`; container exposes `auctionIngesters: Record<AuctionHouse, AuctionIngester>`.
- Cron: for each year, runs the houses in order `['ARTCURIAL', 'ROSSINI']` with `maxRunMs` = `remaining / housesLeft` (600 s total; the second house also gets what the first left), one report per house per year (`reports[]` entries carry `house`); errors per house isolated like per year.
- Eval: `--house artcurial|rossini|all` (default all) filters candidates on `auction.house`.

- [ ] **Step 1: Failing tests** — args: `--house rossini` parsed, `--house foo` throws, default artcurial; cron: ingester mocks per house called with budgets summing to 600 s and Rossini receiving the unused remainder when Artcurial finishes early (fake clock), one house throwing does not stop the other; eval args: `--house` parsed.
- [ ] **Step 2: Run red, implement, run green, whole suite + tsc, commit** — `feat(auction): ingest CLI, cron and eval across houses`

---

### Task 6: Rollout

- [ ] **Step 1:** Apply the migration (user runs `MIGRATE=1 node_modules/.bin/prisma migrate deploy` from the worktree, as before) → `select source, count(*) from photo_references group by 1` shows `AUCTION` and `MANUAL` only.
- [ ] **Step 2:** `pnpm auction:ingest --house rossini --year 2025` (through the key-injecting wrapper), then rerun → `lotsSkippedExisting` equals the first run's `lotsCreated`.
- [ ] **Step 3:** `pnpm eval:auction-references --days 14 --house rossini --verify 10` and read the candidate rate and verdicts.
- [ ] **Step 4:** Merge, push (deploy), then 2024 and 2026 for Rossini; watch the next cron report for `house: 'ROSSINI'`.
