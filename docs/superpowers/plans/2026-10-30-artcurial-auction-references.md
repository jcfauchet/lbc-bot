# Artcurial Auction References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Artcurial sold lots as photo references and alert on a Leboncoin ad whose photos show the same model at a price at least 50 % below the hammer price.

**Architecture:** Lots are rows in the existing `photo_references` / `reference_images` tables tagged `source = 'ARTCURIAL'`, with auction details in a new `auction_lots` table. `RunReferenceMatchUseCase` keeps its flow; the repository returns manual and auction candidates with separate gates, the use case applies the price ratio, a Gemini-only verifier and a daily cap to auction candidates, and groups confirmed lots into one email per ad. A local CLI reads the yearly sitemap, parses the SSR Nuxt payload of sale and lot pages, and upserts and embeds lots.

**Tech Stack:** Next.js 16, Prisma 7 with raw SQL for pgvector (HNSW), Gemini Embedding 2 (768 dims) through `GeminiImageEmbeddingService`, Gemini 3.6 Flash verifier, Vitest, tsx CLIs.

**Spec:** `docs/superpowers/specs/2026-10-30-artcurial-auction-references-design.md`

## Global Constraints

- All code, identifiers and comments in English; French only in user-facing email and page copy (existing convention).
- Commit messages in English, plain, no `Co-Authored-By` lines.
- Vector columns stay out of `schema.prisma`; they live in migration SQL and raw queries (`toVector`, `<=>`), like `reference_images.embedding`.
- Prices on Artcurial pages are euros; the database stores cents.
- The public JSON API of artcurial.com returns mock data and must not be used; only SSR pages and sitemaps.
- Env booleans use `z.enum(['true', 'false'])`, never `z.coerce.boolean()` (see `PROXY_ENABLED` in `src/infrastructure/config/env.ts`).
- The fund must never add a Claude call: auction candidates are verified by Gemini only.
- Repository tests mock `PrismaClient` (project convention, no test database); SQL is checked by the eval CLI against production data in the last task.

## Review Focus

1. A lot page with `status === 'SOLD'` but `adjudicationPrice` null or 0 must be skipped, never stored with a 0 € hammer (Task 7, `toAuctionReference`).
2. The ratio gate at the boundary: ad `priceCents * ratio === hammerPerUnitCents` alerts; one cent above does not (Task 5).
3. The daily cap reached while a listing still has auction candidates: the listing must not be marked checked, and its manual candidates must still be judged (Task 5).
4. An ingest run interrupted and restarted must skip existing lots without re-fetching their images or re-embedding (Task 7).
5. Two confirmed lots on one ad produce one email; when the send fails, neither match is marked notified (Task 5).

---

### Task 1: Migration, schema and env vars

**Files:**
- Create: `prisma/migrations/20261030120000_auction_lots/migration.sql`
- Modify: `prisma/schema.prisma` (PhotoReference model, new AuctionLot model)
- Modify: `src/infrastructure/config/env.ts` (after `REFERENCE_MATCH_MAX_PER_RUN`)
- Test: `src/infrastructure/config/env.test.ts`

**Interfaces:**
- Produces: `env.AUCTION_ALERT_RATIO: number` (default 1.5), `env.AUCTION_REFERENCES_ENABLED: boolean` (default true), `env.AUCTION_VERIFICATIONS_PER_DAY: number` (default 300); Prisma models `PhotoReference.source: String @default("MANUAL")`, `AuctionLot` (table `auction_lots`).

- [ ] **Step 1: Write the failing env tests**

```ts
describe('envSchema auction references', () => {
  it('defaults the alert ratio, the switch and the daily cap', () => {
    const parsed = envSchema.parse(baseEnv)
    expect(parsed.AUCTION_ALERT_RATIO).toBe(1.5)
    expect(parsed.AUCTION_REFERENCES_ENABLED).toBe(true)
    expect(parsed.AUCTION_VERIFICATIONS_PER_DAY).toBe(300)
  })
  it('parses "false" as disabled', () => {
    expect(envSchema.parse({ ...baseEnv, AUCTION_REFERENCES_ENABLED: 'false' }).AUCTION_REFERENCES_ENABLED).toBe(false)
  })
  it('rejects a ratio below 1', () => {
    expect(() => envSchema.parse({ ...baseEnv, AUCTION_ALERT_RATIO: '0.9' })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run src/infrastructure/config/env.test.ts`
Expected: FAIL, `AUCTION_ALERT_RATIO` is undefined.

- [ ] **Step 3: Add the three env vars to `envSchema`**

`AUCTION_ALERT_RATIO: z.coerce.number().min(1).default(1.5)`, `AUCTION_REFERENCES_ENABLED` as an enum like `PROXY_ENABLED` defaulting to `'true'`, `AUCTION_VERIFICATIONS_PER_DAY: z.coerce.number().int().min(0).default(300)`. One comment line each saying what the spike found (ratio decided by the reseller; ~1 candidate per ad at 0.78 with 15k lots).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/infrastructure/config/env.test.ts`
Expected: PASS

- [ ] **Step 5: Edit `prisma/schema.prisma`**

On `PhotoReference`: add `source String @default("MANUAL")` with a doc comment (`MANUAL` | `ARTCURIAL`), `auctionLot AuctionLot?`, and `@@index([source, isActive])`. New model:

```prisma
model AuctionLot {
  id                 String         @id @default(cuid())
  referenceId        String         @unique
  house              String
  saleRef            String
  lotRef             String
  lotUrl             String
  saleName           String
  soldAt             DateTime
  title              String
  artist             String?
  artistYears        String?
  description        String         @db.Text
  estimateLowCents   Int?
  estimateHighCents  Int?
  hammerCents        Int
  finalCents         Int?
  quantity           Int            @default(1)
  hammerPerUnitCents Int
  createdAt          DateTime       @default(now())
  reference          PhotoReference @relation(fields: [referenceId], references: [id], onDelete: Cascade)

  @@unique([house, saleRef, lotRef])
  @@map("auction_lots")
}
```

- [ ] **Step 6: Write the migration SQL by hand**

`ALTER TABLE "photo_references" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL'; CREATE INDEX "photo_references_source_isActive_idx" ON "photo_references"("source", "isActive");` then the `auction_lots` table matching the model (unique indexes on `referenceId` and on `(house, saleRef, lotRef)`, FK cascade), then `CREATE INDEX "reference_images_embedding_hnsw_idx" ON "reference_images" USING hnsw ("embedding" vector_cosine_ops);` with a comment that the fund holds ~30k vectors.

- [ ] **Step 7: Validate the schema and regenerate the client**

Run: `npx prisma validate && npx prisma generate && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$DATABASE_MIGRATION_URL" 2>&1 | tail -5`
Expected: validate OK; the diff reports no change other than the vector index (which Prisma does not model). If the shadow database is unavailable, skip the diff and rely on `prisma validate`.

- [ ] **Step 8: Run the whole test suite and commit**

Run: `npx vitest --run`
Expected: PASS

```bash
git add prisma/schema.prisma prisma/migrations/20261030120000_auction_lots src/infrastructure/config/env.ts src/infrastructure/config/env.test.ts
git commit -m "feat(references): auction_lots table, reference source and auction env vars"
```

---

### Task 2: Quantity parser

**Files:**
- Create: `src/infrastructure/artcurial/quantity.ts`
- Test: `src/infrastructure/artcurial/quantity.test.ts`

**Interfaces:**
- Produces: `parseQuantity(title: string): number` — pieces in a lot from its French title, 1 when nothing is recognised.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['Paire de chauffeuses', 2],
  ['Suite de dix chaises mod. PK9 - 1960', 10],
  ['Ensemble de trois cintres "One, Two, Three" - circa 1984', 3],
  ['Deux cendriers', 2],
  ['Suite de 6 chaises', 6],
  ['Série de quatre appliques', 4],
  ['Table basse', 1],
  ['Lampe "Six" - 1970', 1],
  ['Suite de vingt-quatre assiettes', 24],
])('%s → %i', (title, expected) => expect(parseQuantity(title)).toBe(expected))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run src/infrastructure/artcurial/quantity.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parseQuantity`**

Recognise, case-insensitively at the start of the title: `paire de` → 2; `(suite|ensemble|série|serie|lot) de <number>` → number; `<number> <word>` → number when ≥ 2. Numbers are digits or French words from `deux` to `vingt` plus `vingt-<unit>` up to `vingt-neuf`. Anything else → 1.

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npx vitest --run src/infrastructure/artcurial/quantity.test.ts`
Expected: PASS

```bash
git add src/infrastructure/artcurial/quantity.ts src/infrastructure/artcurial/quantity.test.ts
git commit -m "feat(artcurial): parse the number of pieces from a lot title"
```

---

### Task 3: Artcurial page parsers

**Files:**
- Create: `src/infrastructure/artcurial/devalue.ts`, `src/infrastructure/artcurial/parse-sitemap.ts`, `src/infrastructure/artcurial/parse-sale-page.ts`, `src/infrastructure/artcurial/parse-lot-page.ts`, `src/infrastructure/artcurial/types.ts`
- Create fixtures: `src/infrastructure/artcurial/__fixtures__/lot-IT6064-278-a.html`, `src/infrastructure/artcurial/__fixtures__/sale-IT6064.html`, `src/infrastructure/artcurial/__fixtures__/sitemap-2025-excerpt.xml`
- Test: `src/infrastructure/artcurial/parsers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (in `types.ts`):

```ts
export interface ArtcurialSale {
  ref: string; name: string; status: string; totalLots: number
  specialties: string[]          // specialty refs, e.g. 'DESIGN'
  beginDate: string | null       // ISO
}
export interface ArtcurialLot {
  saleRef: string; lotRef: string           // '278-a'
  status: string                            // 'SOLD' | 'UNSOLD' | …
  title: string; description: string        // HTML stripped, whitespace collapsed
  artist: string | null; artistYears: string | null   // 'Poul KJAERHOLM', '1929-1980'
  estimateLowEur: number | null; estimateHighEur: number | null
  hammerEur: number | null; finalEur: number | null
  soldAt: string | null                     // ISO adjudicationDate
  pictureUrls: string[]                     // document.servingUrl (storage.googleapis.com), catalogue order
}
```
and the functions `extractNuxtData(html: string): unknown[] | null`, `resolveDevalue(arr: unknown[], index: number): unknown` (devalue.ts); `parseSitemap(xml: string): { lotUrlsBySale: Map<string, string[]> }` (sale ref → lot URLs, deduplicated, `/ventes/<ref>/lots/<n>-<sub>` only); `parseSalePage(html: string): ArtcurialSale | null`; `parseLotPage(html: string): ArtcurialLot | null`.

- [ ] **Step 1: Capture the fixtures**

Run, from the repo root, with a desktop User-Agent header (`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36`):
`curl -s -A "$UA" https://www.artcurial.com/ventes/IT6064/lots/278-a -o src/infrastructure/artcurial/__fixtures__/lot-IT6064-278-a.html`, the same for `https://www.artcurial.com/ventes/IT6064`, and for the sitemap keep only the first 40 `<url>` entries of `https://www.artcurial.com/sitemap/sales-2025-fr.xml` plus the ones whose `<loc>` contains `/ventes/IT6064/` (the sitemap is ~5 MB; the excerpt must stay under 100 KB).
Expected: three files; `grep -c __NUXT_DATA__` prints 1 for both HTML files.

- [ ] **Step 2: Write the failing parser tests**

```ts
const lotHtml = readFileSync(join(__dirname, '__fixtures__/lot-IT6064-278-a.html'), 'utf8')
const saleHtml = readFileSync(join(__dirname, '__fixtures__/sale-IT6064.html'), 'utf8')
const sitemap = readFileSync(join(__dirname, '__fixtures__/sitemap-2025-excerpt.xml'), 'utf8')

it('parses the lot page', () => {
  const lot = parseLotPage(lotHtml)!
  expect(lot).toMatchObject({ saleRef: 'IT6064', lotRef: '278-a', status: 'SOLD', hammerEur: 11000,
    estimateLowEur: 8000, estimateHighEur: 12000, artist: 'Poul KJAERHOLM', artistYears: '1929-1980' })
  expect(lot.title).toBe('Suite de dix chaises mod. PK9 - 1960')
  expect(lot.description).toContain('Édition E. Kold Christensen')
  expect(lot.description).not.toContain('<p>')
  expect(lot.pictureUrls.length).toBeGreaterThan(0)
  expect(lot.pictureUrls[0]).toMatch(/^https:\/\/storage\.googleapis\.com\/art-fr-maya-prod-inventory\/.*PICTURE_CATALOG/)
  expect(lot.soldAt).toMatch(/^2025-/)
})
it('parses the sale page', () => {
  expect(parseSalePage(saleHtml)).toMatchObject({ ref: 'IT6064', totalLots: 314 })
  expect(parseSalePage(saleHtml)!.specialties).toContain('DESIGN')
})
it('groups sitemap lot urls by sale', () => {
  const { lotUrlsBySale } = parseSitemap(sitemap)
  expect(lotUrlsBySale.get('IT6064')).toContain('https://www.artcurial.com/ventes/IT6064/lots/278-a')
  expect(new Set(lotUrlsBySale.get('IT6064')).size).toBe(lotUrlsBySale.get('IT6064')!.length)
})
it('returns null on a page without payload', () => {
  expect(parseLotPage('<html></html>')).toBeNull()
  expect(parseSalePage('<html></html>')).toBeNull()
})
it('does not invent a hammer price', () => {
  const html = lotHtml.replace('"adjudicationPrice"', '"adjudicationPriceX"')
  expect(parseLotPage(html)).toBeNull()
})
```
Adjust the `specialties` expectation to the fixture if IT6064 carries another wanted specialty (print it once); the sale's specialties must include at least one of DESIGN, ART_DECO, ITALIAN_DESIGN, FURNITURE_ART_OBJECTS, LIMITED_EDITION.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run src/infrastructure/artcurial/parsers.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement devalue.ts**

`extractNuxtData` finds `<script id="__NUXT_DATA__" …>…</script>` and `JSON.parse`s it. `resolveDevalue(arr, index)` turns the devalue array into plain values: an array entry whose value is an array maps each element index recursively; an object maps each property index; primitives return as is; depth capped at 8 (returns `undefined` beyond). Both pure, no I/O.

- [ ] **Step 5: Implement parse-lot-page.ts and parse-sale-page.ts**

Lot: find the first array entry that is an object with keys `adjudicationPrice`, `descriptions` and `index`; resolve it. `lotRef` = `${index}-${subIndex}`; `artist` = `artist.party.fullName`; `artistYears` = `${yearOfBirth ?? ''}-${yearOfDeath ?? ''}` when `artist` exists, else null; `description` = `descriptions.FRENCH.descriptionWithHtml` with tags removed, `&nbsp;`/`&amp;` decoded, whitespace collapsed; same for `title`. Sale: first entry with keys `specialties`, `ref`, `totalLots`; `specialties` = `specialties[].specialty.ref`; `beginDate` = `vacations[0].validity.beginDate ?? null`.

- [ ] **Step 6: Implement parse-sitemap.ts**

Regex over `<loc>https://www.artcurial.com/ventes/([^/<]+)/lots/[^<]+</loc>`; group by sale ref; deduplicate.

- [ ] **Step 7: Run the tests to verify they pass, then commit**

Run: `npx vitest --run src/infrastructure/artcurial/parsers.test.ts`
Expected: PASS

```bash
git add src/infrastructure/artcurial
git commit -m "feat(artcurial): parse sitemap, sale and lot pages from the SSR payload"
```

---

### Task 4: Repository: candidate gates, auction lots, fund stats

**Files:**
- Modify: `src/domain/repositories/IReferenceRepository.ts`
- Modify: `src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts`
- Test: `src/infrastructure/prisma/repositories/PrismaReferenceRepository.test.ts` (create)

**Interfaces:**
- Produces (domain):

```ts
export type ReferenceSource = 'MANUAL' | 'ARTCURIAL'
export interface AuctionLotSummary {
  house: string; saleRef: string; lotRef: string; lotUrl: string; saleName: string; soldAt: Date
  title: string; artist: string | null; hammerCents: number; quantity: number; hammerPerUnitCents: number
}
export interface ReferenceCandidate {           // existing fields plus:
  source: ReferenceSource
  auction: AuctionLotSummary | null              // set when source === 'ARTCURIAL'
}
export interface CandidateGates {
  /** Manual references: similarity ≥ this, or a keyword hit. */
  minSimilarity: number
  /** Auction lots: similarity ≥ minSimilarity, or a keyword hit with similarity ≥ this. */
  keywordMinSimilarity: number
  /** Auction candidates returned at most; manual candidates are never capped. */
  auctionLimit: number
  includeAuction: boolean
}
export interface PendingAlert {                 // existing fields plus:
  source: ReferenceSource
  similarity: number
  auction: AuctionLotSummary | null
}
export interface NewAuctionLot {
  name: string; note: string; keywords: string[]; imageUrls: string[]
  lot: AuctionLotSummary & {
    artistYears: string | null; description: string
    estimateLowCents: number | null; estimateHighCents: number | null; finalCents: number | null
  }
}
export interface AuctionFundStats { lots: number; images: number; embedded: number }
```
and on `IReferenceRepository`: `findCandidates(listingId: string, gates: CandidateGates): Promise<ReferenceCandidate[]>` (manual candidates first, then auction by `textHit DESC, similarity DESC`); `createAuctionLot(input: NewAuctionLot): Promise<{ id: string; images: ImageToEmbed[] } | null>` (null when `(house, saleRef, lotRef)` exists; the reference is created with `source: 'ARTCURIAL'`, `maxPriceCents: null`, `backfilledAt: now`); `countAuctionVerificationsSince(since: Date): Promise<number>` (rows of `reference_matches` joined to references with `source = 'ARTCURIAL'` and `createdAt >= since`); `auctionFundStats(): Promise<AuctionFundStats>`. `list()` returns manual references only. `findReferencesToBackfill()` and `findRecentListingsCloseTo()` restrict to `source = 'MANUAL'`.

- [ ] **Step 1: Write the failing repository tests (mocked Prisma, project convention)**

```ts
it('createAuctionLot returns null when the lot already exists', async () => {
  const prisma = { auctionLot: { findUnique: vi.fn(async () => ({ id: 'a1' })) }, photoReference: { create: vi.fn() } } as any
  expect(await new PrismaReferenceRepository(prisma).createAuctionLot(newLot())).toBeNull()
  expect(prisma.photoReference.create).not.toHaveBeenCalled()
})
it('createAuctionLot creates the reference, its lot and up to three images, backfilled at once', async () => {
  const create = vi.fn(async (args: any) => ({ id: 'r1', images: args.data.images.create.map((i: any, n: number) => ({ id: `i${n}`, urlRemote: i.urlRemote })) }))
  const prisma = { auctionLot: { findUnique: vi.fn(async () => null) }, photoReference: { create } } as any
  const res = await new PrismaReferenceRepository(prisma).createAuctionLot(newLot({ imageUrls: ['u1', 'u2', 'u3', 'u4'] }))
  expect(res).toEqual({ id: 'r1', images: [{ id: 'i0', url: 'u1' }, { id: 'i1', url: 'u2' }, { id: 'i2', url: 'u3' }] })
  const data = create.mock.calls[0][0].data
  expect(data.source).toBe('ARTCURIAL'); expect(data.maxPriceCents).toBeNull(); expect(data.backfilledAt).toBeInstanceOf(Date)
  expect(data.auctionLot.create).toMatchObject({ house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a', hammerPerUnitCents: 110000 })
})
it('list only returns manual references', async () => {
  const findMany = vi.fn(async () => [])
  await new PrismaReferenceRepository({ photoReference: { findMany } } as any).list()
  expect(findMany.mock.calls[0][0].where).toEqual({ source: 'MANUAL' })
})
it('findCandidates skips the auction query when the fund is disabled', async () => {
  const queryRaw = vi.fn(async () => [])
  await new PrismaReferenceRepository({ $queryRaw: queryRaw } as any).findCandidates('l1', { minSimilarity: 0.78, keywordMinSimilarity: 0.7, auctionLimit: 3, includeAuction: false })
  expect(queryRaw).toHaveBeenCalledTimes(1)
})
it('findCandidates puts manual candidates before auction ones', async () => { /* two $queryRaw results, assert order and source fields */ })
it('countAuctionVerificationsSince counts matches of ARTCURIAL references', async () => { /* $queryRaw returns [{ count: 7n }] → 7 */ })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run src/infrastructure/prisma/repositories/PrismaReferenceRepository.test.ts`
Expected: FAIL, methods missing / type errors.

- [ ] **Step 3: Update the domain interface** as in the Interfaces block; keep every existing method and field.

- [ ] **Step 4: Implement the repository changes**

`findCandidates` runs two `$queryRaw` statements. Manual: the existing query with `AND r."source" = 'MANUAL'`, selecting `'MANUAL' AS "source"`. Auction (only when `includeAuction`):

```sql
WITH nn AS (
  SELECT ri."referenceId", MAX(1 - (li."embedding" <=> ri."embedding")) AS sim
  FROM "listing_images" li
  CROSS JOIN LATERAL (
    SELECT ri."referenceId", ri."embedding" FROM "reference_images" ri
    WHERE ri."embedding" IS NOT NULL
    ORDER BY ri."embedding" <=> li."embedding" LIMIT 50
  ) ri
  WHERE li."listingId" = $listingId AND li."embedding" IS NOT NULL
  GROUP BY ri."referenceId"
)
SELECT r."id" AS "referenceId", r."name", r."note", r."maxPriceCents", 'ARTCURIAL' AS "source",
       COALESCE(nn.sim, 0) AS "similarity", <KEYWORD_HIT_SQL> AS "textHit",
       (SELECT ARRAY_AGG("urlRemote" ORDER BY "createdAt", "id") FROM "reference_images" WHERE "referenceId" = r."id") AS "imageUrls",
       a."house", a."saleRef", a."lotRef", a."lotUrl", a."saleName", a."soldAt", a."title", a."artist",
       a."hammerCents", a."quantity", a."hammerPerUnitCents"
FROM "lbc_product_listings" p
CROSS JOIN "photo_references" r
JOIN "auction_lots" a ON a."referenceId" = r."id"
LEFT JOIN nn ON nn."referenceId" = r."id"
WHERE p."id" = $listingId AND r."isActive" AND r."source" = 'ARTCURIAL'
  AND NOT EXISTS (SELECT 1 FROM "reference_matches" m WHERE m."referenceId" = r."id" AND m."listingId" = p."id")
  AND (COALESCE(nn.sim, 0) >= $minSimilarity OR (<KEYWORD_HIT_SQL> AND COALESCE(nn.sim, 0) >= $keywordMinSimilarity))
ORDER BY "textHit" DESC, "similarity" DESC
LIMIT $auctionLimit
```
Map the `a.*` columns into `auction`. `findPendingAlerts` includes `reference.auctionLot` and `reference.source`, and `m.similarity`. `createAuctionLot`: `auctionLot.findUnique` on the compound unique, then one `photoReference.create` with nested `auctionLot: { create }` and `images: { create }` (first three `imageUrls`). `auctionFundStats`: three counts (`photoReference.count({ where: { source: 'ARTCURIAL' } })`, `$queryRaw` counts on `reference_images` joined to ARTCURIAL references, with and without embedding).

- [ ] **Step 5: Fix the compile errors in callers**

`RunReferenceMatchUseCase.findWideCandidates` passes `{ minSimilarity: widenSimilarity, keywordMinSimilarity: widenSimilarity, auctionLimit: maxCandidatesPerListing, includeAuction: true }` for now (Task 5 replaces it); the use case test's `candidate()` helper gains `source: 'MANUAL', auction: null`, `alert()` gains `source: 'MANUAL', similarity: 0.8, auction: null`.

- [ ] **Step 6: Run the whole suite, then commit**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add src/domain/repositories/IReferenceRepository.ts src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts src/infrastructure/prisma/repositories/PrismaReferenceRepository.test.ts src/application/use-cases
git commit -m "feat(references): auction lots in the repository, separate candidate gates per source"
```

---

### Task 5: Matching use case: ratio gate, Gemini-only verifier, daily cap, grouped email

**Files:**
- Modify: `src/application/use-cases/RunReferenceMatchUseCase.ts`
- Modify: `src/infrastructure/mail/EmailTemplates.ts` (add `auctionMatch`)
- Test: `src/application/use-cases/RunReferenceMatchUseCase.test.ts`, `src/infrastructure/mail/EmailTemplates.test.ts`

**Interfaces:**
- Consumes: Task 4 types (`ReferenceCandidate.source/auction`, `CandidateGates`, `PendingAlert.source/auction/similarity`, `countAuctionVerificationsSince`).
- Produces: constructor `new RunReferenceMatchUseCase(repo, embedder, verifiers: { manual: IReferenceMatchVerifier; auction: IReferenceMatchVerifier }, mailer, config, now?)`; `ReferenceMatchConfig` gains `auctionEnabled: boolean`, `auctionAlertRatio: number`, `auctionVerificationsPerDay: number`; `EmailTemplates.auctionMatch(alerts: PendingAlert[]): { subject: string; html: string }` (all alerts share one listing; sorted by similarity desc by the caller).

- [ ] **Step 1: Write the failing use case tests**

In `setup`, add `auctionVerifier` (own `vi.fn`), `repo.countAuctionVerificationsSince: vi.fn(async () => opts.auctionCount ?? 0)`, and config defaults `auctionEnabled: true, auctionAlertRatio: 1.5, auctionVerificationsPerDay: 300`. Helper `auctionCandidate(id, hammerPerUnitCents, overrides)` with `source: 'ARTCURIAL'` and a full `auction` summary. Tests:

```ts
it('skips an auction lot whose per-unit hammer is under the ratio, before any verifier call', async () => {
  // ad 20 000 cents, hammer per unit 29 999 → 20 000 × 1.5 = 30 000 > 29 999 → skipped
  expect(auctionVerifier.verify).not.toHaveBeenCalled(); expect(repo.markListingChecked).toHaveBeenCalledWith('l1')
})
it('verifies an auction lot exactly at the ratio with the auction verifier only', async () => {
  // hammer per unit 30 000 → verified; manual verifier untouched
})
it('passes the auction gates to findCandidates', async () => {
  // the repository is queried at the widen level; the 0.78 gate is applied by the use case afterwards, as today
  expect(repo.findCandidates).toHaveBeenLastCalledWith('l1', { minSimilarity: 0.7, keywordMinSimilarity: 0.7, auctionLimit: 3, includeAuction: true })
})
it('asks for no auction candidates when the fund is disabled', async () => { /* includeAuction: false */ })
it('leaves auction candidates unjudged and the listing unchecked once the daily cap is reached, but still judges manual ones', async () => {
  // auctionCount: 300, candidates: [manual m1, auction a1] → verifier called for m1 only, markListingChecked not called
})
it('sends one email for two confirmed lots on the same ad, closest first, and marks both notified', async () => {
  // pending: [auction alert a1 sim 0.80, a2 sim 0.85, same listingId] → mailer.send once, subject starts with '🔨', html lists a2 before a1, markNotified called with both
})
it('marks neither match notified when the grouped send fails', async () => {})
it('still sends the manual alert email unchanged', async () => { /* subject starts with '🎯' */ })
```

- [ ] **Step 2: Write the failing template test**

```ts
it('auctionMatch shows the ad price, the hammer price and the per-unit price when the lot is a set', () => {
  const { subject, html } = EmailTemplates.auctionMatch([alertWithAuction({ hammerCents: 170000, quantity: 10, hammerPerUnitCents: 17000 })])
  expect(subject).toBe('🔨 Vu chez Artcurial à 1700 € : Chaise pliante Plia')
  expect(html).toContain('170 €'); expect(html).toContain('la pièce'); expect(html).toContain('https://www.artcurial.com/ventes/IT6064/lots/415-a')
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run src/application/use-cases/RunReferenceMatchUseCase.test.ts src/infrastructure/mail/EmailTemplates.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the use case changes**

- `findWideCandidates` passes the gates from config: `minSimilarity: widenSimilarity, keywordMinSimilarity: widenSimilarity, auctionLimit: maxCandidatesPerListing, includeAuction: auctionEnabled`; the final filter becomes: manual → `textHit || similarity >= minSimilarity` (as today); auction → `similarity >= minSimilarity || (textHit && similarity >= widenSimilarity)`.
- `judge`: for `source === 'ARTCURIAL'`, skip when `listing.priceCents * auctionAlertRatio > candidate.auction.hammerPerUnitCents`; use `verifiers.auction`; otherwise the manual gate and `verifiers.manual`.
- Daily cap: at run start `budget.auctionLeft = max(0, auctionVerificationsPerDay - countAuctionVerificationsSince(startOfUtcDay(now)))`; each auction verification decrements it. In the listing loop, when auction candidates remain but `auctionLeft === 0`, judge the manual ones, do not call `markListingChecked`, and continue.
- `sendPendingAlerts`: group auction alerts by `listingId`, sort each group by similarity desc, send `EmailTemplates.auctionMatch(group)`, mark every match of the group notified after the send; manual alerts unchanged.

- [ ] **Step 5: Implement `EmailTemplates.auctionMatch`**

Same layout as `referenceMatch`: title `🔨 Vu chez Artcurial`, ad photo next to the best lot photo, ad title linked, ad price in orange, then per lot: lot title (artist first when present), "Adjugé <hammer> € le <d/m/yyyy>" plus "(<per-unit> € la pièce, lot de N)" when `quantity > 1`, sale name, link "Voir le lot" to `lotUrl`, Gemini's reason; the existing "Voir l'annonce" button, the references button and the 👍/👎 line. Subject `🔨 Vu chez Artcurial à <hammer of best lot> € : <listing title>`.

- [ ] **Step 6: Run the tests to verify they pass, then commit**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/application/use-cases/RunReferenceMatchUseCase.ts src/application/use-cases/RunReferenceMatchUseCase.test.ts src/infrastructure/mail/EmailTemplates.ts src/infrastructure/mail/EmailTemplates.test.ts
git commit -m "feat(references): price ratio, Gemini-only verifier and daily cap for auction lots, grouped alert email"
```

---

### Task 6: Wiring, fund switch and references page line

**Files:**
- Modify: `src/infrastructure/di/container.ts` (reference use case construction)
- Create: `src/app/api/references/fund/route.ts`
- Modify: `src/app/feedback/references/page.tsx` (one line under the "Mes références" heading)
- Test: `src/app/api/references/fund/route.test.ts` (same shape as the existing `auth.test.ts` usage: wrong key → 401)

**Interfaces:**
- Consumes: Task 5 constructor; `env.AUCTION_*` from Task 1; `repo.auctionFundStats()` from Task 4.
- Produces: `GET /api/references/fund?k=` → `{ lots, images, embedded, enabled }`.

- [ ] **Step 1: Write the failing route test** (401 without the key; 200 with the key returns the four fields). Mock the container module with `vi.mock('@/infrastructure/di/container', () => ({ container: { referenceRepository: { auctionFundStats: async () => ({ lots: 311, images: 740, embedded: 740 }) } } }))` and the env module's `REFERENCES_KEY`, so the test never builds the real container.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run src/app/api/references/fund`
Expected: FAIL, module not found.

- [ ] **Step 3: Wire the container**

`verifiers: { manual: claudeFirst(...) as today, auction: new GeminiReferenceMatchVerifier(geminiApiKey) }`; config adds `auctionEnabled: env.AUCTION_REFERENCES_ENABLED, auctionAlertRatio: env.AUCTION_ALERT_RATIO, auctionVerificationsPerDay: env.AUCTION_VERIFICATIONS_PER_DAY`; `maxVerificationsPerRun: 40` with a one-line comment (~1 auction candidate per ad at 0.78).

- [ ] **Step 4: Add the fund route and the page line**

Route mirrors `GET /api/references` (key check, `container.referenceRepository.auctionFundStats()`, `enabled: env.AUCTION_REFERENCES_ENABLED`). Page: fetch it with the list; render under the heading `Fonds Artcurial : {lots} lots, {images} photos, {enabled ? 'actif' : 'inactif'}` in small grey text, nothing when the fetch fails.

- [ ] **Step 5: Run the suite, type-check, commit**

Run: `npx vitest --run && npx tsc --noEmit && npx next lint`
Expected: PASS.

```bash
git add src/infrastructure/di/container.ts src/app/api/references/fund src/app/feedback/references/page.tsx
git commit -m "feat(references): wire the auction verifier and show the Artcurial fund on the references page"
```

---

### Task 7: Ingester and CLI

**Files:**
- Create: `src/infrastructure/artcurial/ArtcurialIngester.ts`, `src/infrastructure/artcurial/ArtcurialFetcher.ts`, `src/infrastructure/artcurial/to-auction-reference.ts`
- Create: `src/cli/artcurial-ingest.ts`, `src/cli/artcurial-ingest-args.ts`
- Modify: `package.json` (script `"artcurial:ingest": "tsx src/cli/artcurial-ingest.ts"`)
- Test: `src/infrastructure/artcurial/ArtcurialIngester.test.ts`, `src/infrastructure/artcurial/to-auction-reference.test.ts`, `src/cli/artcurial-ingest-args.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseQuantity`, Task 3 parsers and types, Task 4 `createAuctionLot` / `setReferenceImageEmbedding`, `IImageEmbeddingService`.
- Produces:

```ts
// to-auction-reference.ts
export const WANTED_SPECIALTIES = ['DESIGN', 'ART_DECO', 'ITALIAN_DESIGN', 'FURNITURE_ART_OBJECTS', 'LIMITED_EDITION']
export const EXCLUDED_SPECIALTIES = ['INVENTORIES', 'HOTEL']
export function isWantedSale(sale: ArtcurialSale): boolean
export function lotImageUrl(servingUrl: string): string   // https://www.artcurial.com/item-images/<path after the bucket>?w=1024
// Derive the path from pictures[].document.servingUrl (strip https://storage.googleapis.com/art-fr-maya-prod-inventory/),
// not from blobName: on older lots blobName lacks the leading folder ('/611/x.jpg' instead of 'FR/611/x.jpg') and the proxy 404s.
export function toAuctionReference(lot: ArtcurialLot, sale: ArtcurialSale, lotUrl: string): NewAuctionLot | null  // null unless SOLD with hammer > 0
// ArtcurialFetcher.ts
export interface PageFetcher { fetchText(url: string): Promise<string> }
export class ArtcurialFetcher implements PageFetcher  // desktop UA, 15 s timeout, one retry on 5xx/network error, throws on 4xx
// ArtcurialIngester.ts
export interface IngestOptions { year: number; saleRef?: string; limit?: number; dryRun: boolean; concurrency: number }
export interface IngestReport { salesKept: string[]; lotsSeen: number; lotsCreated: number; lotsSkippedExisting: number; lotsSkippedUnsold: number; lotsFailed: number; imagesEmbedded: number; imagesFailed: number }
export class ArtcurialIngester {
  constructor(fetcher: PageFetcher, repo: IReferenceRepository, embedder: IImageEmbeddingService, log: (line: string) => void)
  ingest(options: IngestOptions): Promise<IngestReport>
}
// artcurial-ingest-args.ts
export function parseArtcurialIngestArgs(args: string[]): IngestOptions  // --year (required), --sale, --limit, --dry-run, --concurrency (default 3)
```

- [ ] **Step 1: Write the failing `to-auction-reference` tests**

```ts
it('keeps a design sale and drops a hotel inventory, a test sale and a tiny sale', () => {
  expect(isWantedSale(sale({ specialties: ['DESIGN'] }))).toBe(true)
  expect(isWantedSale(sale({ specialties: ['FURNITURE_ART_OBJECTS', 'INVENTORIES'] }))).toBe(false)
  expect(isWantedSale(sale({ specialties: ['DESIGN'], name: 'Vente TEST' }))).toBe(false)
  expect(isWantedSale(sale({ specialties: ['DESIGN'], totalLots: 4 }))).toBe(false)
  expect(isWantedSale(sale({ specialties: ['OLDMASTER_PAINTINGS'] }))).toBe(false)
})
it('builds the reference from a sold lot', () => {
  const bucket = 'https://storage.googleapis.com/art-fr-maya-prod-inventory/'
  const ref = toAuctionReference(lot({ title: 'Suite de dix chaises mod. PK9 - 1960', artist: 'Poul KJAERHOLM', hammerEur: 11000, pictureUrls: [bucket + 'a', bucket + 'b', bucket + 'c', bucket + 'd'] }), sale(), 'https://www.artcurial.com/ventes/IT6064/lots/278-a')!
  expect(ref.name).toBe('Poul KJAERHOLM — Suite de dix chaises mod. PK9 - 1960')
  expect(ref.keywords).toEqual(['poul kjaerholm'])
  expect(ref.imageUrls).toEqual(['https://www.artcurial.com/item-images/a?w=1024', 'https://www.artcurial.com/item-images/b?w=1024', 'https://www.artcurial.com/item-images/c?w=1024'])
  expect(ref.lot).toMatchObject({ hammerCents: 1100000, quantity: 10, hammerPerUnitCents: 110000, house: 'ARTCURIAL', saleRef: 'IT6064', lotRef: '278-a' })
  expect(ref.note).toMatch(/Adjugé 11000 € le \d{2}\/\d{2}\/\d{4}, Artcurial /)
})
it('uses the title alone and no keyword when there is no artist', () => {})
it('returns null for an unsold lot and for a sold lot without hammer price', () => {})
it('caps the note description at 400 characters before the price line', () => {})
```

- [ ] **Step 2: Write the failing ingester tests (fake fetcher serving the Task 3 fixtures, fake repo, fake embedder)**

```ts
it('fetches the sitemap, keeps wanted sales, creates sold lots and embeds their images', async () => {
  // fetcher map: sitemap excerpt → sale page → lot page (same lot page served for every lot url)
  // expect repo.createAuctionLot called once per lot url of IT6064 in the excerpt, embedder once per returned image
})
it('skips existing lots without embedding anything', async () => { /* repo.createAuctionLot → null; report.lotsSkippedExisting; embedder not called */ })
it('counts an embedding failure and keeps going', async () => { /* embedder throws on first url; imagesFailed 1; next lot still created */ })
it('records a failed lot page and continues', async () => { /* fetcher throws for one url; lotsFailed 1 */ })
it('dry run lists the sales and creates nothing', async () => {})
it('--limit stops after N lots', async () => {})
```

- [ ] **Step 3: Write the failing args test** (`--year 2025 --sale IT6064 --limit 50 --dry-run` parsed; missing `--year` throws).

- [ ] **Step 4: Run the three test files to verify they fail**

Run: `npx vitest --run src/infrastructure/artcurial src/cli/artcurial-ingest-args.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement `to-auction-reference.ts`**

`note` = first 400 chars of the description, then `Adjugé <hammer> € le <dd/mm/yyyy>, Artcurial <sale name>`. Cents = `Math.round(eur * 100)`; `hammerPerUnitCents = Math.round(hammerCents / quantity)`; `soldAt = new Date(lot.soldAt ?? sale.beginDate)`.

- [ ] **Step 6: Implement `ArtcurialFetcher` and `ArtcurialIngester`**

Ingester flow: sitemap → `parseSitemap` → for each sale ref (or only `saleRef`): fetch sale page, `parseSalePage`, `isWantedSale`; log the kept sales as `kept <ref> <name> <totalLots> lots <specialties>`; stop here on `dryRun`. Then lot URLs with `concurrency` workers: fetch, `parseLotPage`, `toAuctionReference`, `repo.createAuctionLot`, then for each returned image `embedder.embedImage(url)` → `repo.setReferenceImageEmbedding`. Progress line every 25 lots. `limit` counts lot URLs attempted.

- [ ] **Step 7: Implement the CLI and the package script**

`src/cli/artcurial-ingest.ts`: header comment with usage, builds `new ArtcurialIngester(new ArtcurialFetcher(), container.referenceRepository, container.imageEmbeddingService, console.log)`, prints the report as JSON at the end, exits 1 when `lotsFailed > 0`.

- [ ] **Step 8: Run the tests, type-check, commit**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/infrastructure/artcurial src/cli/artcurial-ingest.ts src/cli/artcurial-ingest-args.ts src/cli/artcurial-ingest-args.test.ts package.json
git commit -m "feat(artcurial): ingest CLI that turns sold lots into photo references"
```

---

### Task 8: Evaluation CLI

**Files:**
- Create: `src/cli/eval-auction-references.ts`, `src/cli/eval-auction-references-args.ts`
- Modify: `package.json` (script `"eval:auction-references": "tsx src/cli/eval-auction-references.ts"`)
- Modify: `src/domain/repositories/IReferenceRepository.ts` and `PrismaReferenceRepository.ts` (one read method)
- Test: `src/cli/eval-auction-references-args.test.ts`

**Interfaces:**
- Consumes: Task 4 `findCandidates`, Task 5 verifier wiring (`GeminiReferenceMatchVerifier`).
- Produces: `parseEvalAuctionReferencesArgs(args): { days: number; verify: number; thresholds: number[] }` (defaults 14, 0, `[0.75, 0.78, 0.8]`); repository `findRecentListingsWithEmbeddedCover(days: number, limit: number): Promise<ListingToCheck[]>` (cover embedded, not voted down, newest first).

- [ ] **Step 1: Write the failing args test** (defaults; `--days 7 --verify 20 --thresholds 0.76,0.8`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest --run src/cli/eval-auction-references-args.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the args parser, the repository method and the CLI**

CLI: for each threshold, call `findCandidates(listing.id, { minSimilarity: t, keywordMinSimilarity: env.REFERENCE_MATCH_WIDEN_SIMILARITY, auctionLimit: 3, includeAuction: true })` on up to 500 listings; print per threshold: listings with ≥ 1 auction candidate, candidates total, candidates passing `priceCents * AUCTION_ALERT_RATIO <= hammerPerUnitCents`. Then, with `--verify N`, run `GeminiReferenceMatchVerifier` on the first N gated pairs at the default threshold and print one line each: verdict, similarity, ad price, hammer per unit, ad URL, lot URL. Read-only: no `reference_matches` written.

- [ ] **Step 4: Run the tests, type-check, commit**

Run: `npx vitest --run && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/cli/eval-auction-references.ts src/cli/eval-auction-references-args.ts src/cli/eval-auction-references-args.test.ts src/domain/repositories/IReferenceRepository.ts src/infrastructure/prisma/repositories/PrismaReferenceRepository.ts package.json
git commit -m "feat(references): eval CLI replaying recent ads against the auction fund"
```

---

### Task 9: Rollout on real data

**Files:** none (operations). Needs the user's go for each step that touches production.

- [ ] **Step 1: Apply the migration**

Ask the user, then run: `MIGRATE=1 npx prisma migrate deploy`
Expected: `20261030120000_auction_lots` applied; `psql "$DATABASE_URL" -c '\d auction_lots'` shows the table.

- [ ] **Step 2: Ingest one Online sale**

Run: `pnpm artcurial:ingest --year 2025 --sale IT6064`
Expected: report with `lotsCreated` ≈ 311, `imagesFailed` 0 or a handful; a second run reports `lotsSkippedExisting` ≈ 311 and `lotsCreated` 0.

- [ ] **Step 3: Replay recent ads**

Run: `pnpm eval:auction-references --days 14 --verify 20`
Expected: roughly 1 % of ads with a candidate at 0.78 for this one sale (≈ 0.01 lots per ad × 311 lots in the spike); read the 20 verdicts and the pairs, and check the `findCandidates` timing printed by the CLI stays under 300 ms per listing.

- [ ] **Step 4: Check the production stage**

After deploy (push to main), look at the next `analyze-and-notify` run log for the `references` stage counts, then: `psql "$DATABASE_URL" -c "select r.source, count(*), sum(case when m.confirmed then 1 else 0 end) from reference_matches m join photo_references r on r.id = m.\"referenceId\" where m.\"createdAt\" > now() - interval '1 day' group by 1"`.

- [ ] **Step 5: Full ingest, in the background**

Run: `pnpm artcurial:ingest --year 2025`, then 2024, then 2026. Resumable; expect a few hours each. Report the final counts and the fund line on `/feedback/references`.
