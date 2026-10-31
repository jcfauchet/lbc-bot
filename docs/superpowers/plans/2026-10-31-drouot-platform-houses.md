# Drouot-Platform Houses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Osenat, PBA, Gros & Delettrez (Drouot "site générique" platform) and Ader to the auction fund through one configurable Drouot adapter plus an Ader adapter.

**Architecture:** The Rossini parsers and adapter become `src/infrastructure/drouot/` (`DrouotPlatformAdapter` + `DrouotHouseConfig`), Rossini becomes one config; `src/infrastructure/ader/` holds the Ader adapter; houses are listed in one config table that builds the container's ingesters, the CLI slugs and the cron order.

**Tech Stack:** TypeScript, Vitest, existing `AuctionIngester` / `HouseAdapter`.

**Spec:** `docs/superpowers/specs/2026-10-31-drouot-platform-houses-design.md` (read "Builder questions, settled").

## Global Constraints

- All code, identifiers and comments in English; French only in the user-facing `note` and email copy.
- Only public pages are fetched; never `/recherche/*`; respect each robots.txt.
- Matching and the ratio gate keep using `hammerCents`; fee-inclusive prices go to `finalCents`, hammer derived with the house rate.
- Sandbox: implementers cannot run git or npx; use `node_modules/.bin/*`, leave files uncommitted and list them.
- Fixtures are captured live with the desktop UA, one request per second.

## Review Focus

1. A fee-inclusive lot must never be stored with the shown price as hammer (Task 1).
2. A sale filtered by the house's regex must not be kept by another house's regex (Task 2).
3. An Ader lot page linking to another sale must throw, not be stored under the walked sale (Task 3).
4. A 429 must be retried once after 5 s, never counted as a permanent 4xx (Task 1).
5. The cron must still respect one 600 s budget with six houses (Task 4).

---

### Task 1: Generalise Rossini into a configurable Drouot-platform adapter

**Files:** move `src/infrastructure/rossini/*` to `src/infrastructure/drouot/` (parsers, fixtures, tests), rename `RossiniAdapter` → `DrouotPlatformAdapter`, add `src/infrastructure/drouot/house-configs.ts`; modify `src/infrastructure/artcurial/ArtcurialFetcher.ts` (+ test) for the 429 retry; `src/domain/auction-houses.ts` adds `OSENAT`, `PBA`, `GROS_DELETTREZ`, `ADER` with labels (`Osenat`, `PBA`, `Gros & Delettrez`, `Ader`).

**Interfaces:**
```ts
export interface DrouotHouseConfig {
  house: AuctionHouse
  baseUrl: string                  // 'https://www.rossini.fr'
  resultsPath: string              // 'resultats' | 'resultats-ventes-passees'
  /** Buyer's premium used to derive the hammer from a fee-inclusive result. */
  premiumRate: number              // 0 for Rossini
  /** Used when a sold lot shows no "Résultats avec/sans frais" label. */
  resultIncludesFeesByDefault: boolean
  wantedTitle: RegExp
  concurrency: number
}
export const DROUOT_HOUSES: Record<'ROSSINI'|'OSENAT'|'PBA'|'GROS_DELETTREZ', DrouotHouseConfig>
```
`parseLotPage` gains `resultIncludesFees: boolean | null` (from the label; null when absent) and `photoHostId: string | null` (the CDN house id read from the photo URLs of the lot's own sale). Photos use the `fullHD` variant. `toAuctionReference(lot, sale, config)`: when fees are included (label, or config default when null) → `finalCents = round(eur×100)`, `hammerCents = round(finalCents / (1 + premiumRate))`, note `Résultat N € frais compris (≈ M € au marteau), <Label> <sale title>`; otherwise as today. `isWantedSale(sale, regex)`.

Configs (regexes drafted from the recon titles; the rollout dry run validates them):
- ROSSINI: rate 0, default false, `/mobilier|objets? d.art|intérieurs?|design|classiques de rossini|collections classiques/i`, concurrency 3.
- OSENAT: `https://www.osenat.com`, `resultats-ventes-passees`, rate 0.28, default true, `/mobilier|objets? d.art|intérieurs?|esprit du xi?xe|grands siècles|empire|royauté|design|arts? décoratifs/i`, concurrency 3.
- PBA: `https://www.pba-auctions.com`, `resultats`, rate 0.30, default true, `/intérieur|appartements|mobilier|objets? d.art|design|arts? décoratifs|collection/i`, concurrency 1.
- GROS_DELETTREZ: `https://www.gros-delettrez.com`, `resultats`, rate 0.30, default true, `/arts? décoratifs|mobilier|objets? d.art|design/i`, concurrency 3.

Fetcher: a 429 response waits 5 s (injectable sleep) and retries once; still 429 → throws a non-client error.

- [ ] Tests first: existing Rossini tests pass unchanged after the move (Rossini config); `toAuctionReference` with fees label → final 128 000 cents, hammer 100 000 at rate 0.28; label absent + default true → same; label "sans frais" → hammer = shown; photo URLs `fullHD/<photoHostId>/…`; fetcher 429 then 200 → one retry after 5 s; 429 twice → throws, not a `ClientError`.
- [ ] Implement, run `node_modules/.bin/vitest --run` + `tsc --noEmit`.
- [ ] Commit: `refactor(drouot): configurable Drouot-platform adapter, fee-inclusive prices, 429 retry`

### Task 2: Osenat, PBA, Gros & Delettrez fixtures and wiring

**Files:** `src/infrastructure/drouot/__fixtures__/{osenat,pba,gros-delettrez}-{year,catalogue,lot}.html` (one year page 2025, one catalogue page of a kept sale, one sold lot page each; PBA requests spaced 3 s), tests in `src/infrastructure/drouot/houses.test.ts`; `src/infrastructure/di/container.ts` builds `auctionIngesters` from `DROUOT_HOUSES` + Artcurial (+ Ader in Task 3); `src/cli/auction-ingest-args.ts` and `eval-auction-references-args.ts` accept the slugs `rossini, osenat, pba, gros-delettrez, artcurial` (and `ader` after Task 3) from one `HOUSE_SLUGS` map in `src/domain/auction-houses.ts`.

- [ ] Tests per house on its fixtures: the year page lists sales and the house regex keeps at least one furniture sale and drops a jewellery/wine sale present on the page; the lot page yields a fee-inclusive result with the right hammer derivation and ≥ 1 photo hash; the catalogue yields 50 lot URLs of that sale.
- [ ] CLI/eval args tests for the new slugs.
- [ ] Commit: `feat(drouot): Osenat, PBA and Gros & Delettrez in the auction fund`

### Task 3: Ader adapter

**Files:** `src/infrastructure/ader/{parse-sales-sitemap.ts,parse-sale-page.ts,parse-lot-page.ts,AderAdapter.ts,house-config.ts}` + `parsers.test.ts`, `AderAdapter.test.ts`, fixtures `__fixtures__/{sales-2025.xml (trimmed to ~20 entries),sale-182231-p1.html,lot-<id>.html}`.

Behaviour (spec "Builder questions, settled"): `listSales(year)` reads `https://ader-paris.fr/sitemap-sales-past-<year>-fr-01.xml` (and `-02`… while present), fetches each sale page lazily, parses title, date (French date parser from `src/infrastructure/drouot/french-date.ts`), lot count; keeps by the Ader regex `/xxe|design|arts? décoratifs|mobilier|objets? d.art|intérieur|verre|céramique/i` and ≥ 5 lots; `listLotUrls` walks `?page=N` until no new `/l/<id>` hrefs (cap 40 pages); `fetchLot` parses `Estimation a € - b €`, `Résultat N €`, `Frais de vente NN%` (rate, default 0.32), title (`Lot n°X - <title>`), description, photos `cdn.drouot.com/d/lot/fullHD/97/<saleId>/<hash>` of its own sale, sale link check; fee-inclusive conversion as Task 1.

- [ ] Tests on the fixtures: sitemap → sale ids; sale page → title, `2026-10-23`, 360 lots, 50 lot URLs; lot page → estimate, result, rate 0.32, hammer derived, photos; foreign sale link → throws; unsold lot (no Résultat) → null.
- [ ] Wire `ADER` into the house table, container, slugs.
- [ ] Commit: `feat(ader): Ader adapter for the auction fund`

### Task 4: Cron over all houses

**Files:** `src/app/api/cron/artcurial-ingest/route.ts` (+ test).

- [ ] House order from one exported `CRON_HOUSE_ORDER` (ROSSINI, OSENAT, PBA, GROS_DELETTREZ, ADER, ARTCURIAL); slots `years × houses` share 600 s as today; each house uses its config concurrency. Tests: six houses called in order, budgets sum ≤ 600 000; a throwing house does not stop the others.
- [ ] Commit: `feat(auction): daily cron over every configured house`

### Task 5: Rollout

- [ ] Per house: `--dry-run --year 2025` (read kept sale titles, fix the regex if needed) → `--sale <one kept> --limit 20` (unsold < 50 %, compare one hammer with the site) → full 2025 → eval `--house <slug>` → 2024, 2026.
- [ ] Merge and push (deploy) once the code tasks are green.
