# Drouot-platform houses in the auction fund — design

**Date:** 2026-10-31
**Context:** Artcurial and Rossini feed the photo-reference fund. A recon of
twelve houses (31 Oct 2026) found that Osenat, PBA (Pierre Bergé & Associés) and
Gros & Delettrez run on the same Drouot "site générique" platform as Rossini,
and that Ader runs on a newer Drouot template with the same data. All four
publish sold prices without an account and allow crawling (robots.txt only
forbids their internal search). The reseller asked to add them.

## Intent

One configurable adapter for the Drouot platform, instantiated per house, so a
new house on that platform is a configuration entry plus a sale-title filter,
not a new parser. Ader gets a sibling adapter for its template. Everything
downstream (ingester, matching, email, cron, eval) is shared and unchanged.

## Decisions

| Question | Decision |
|---|---|
| Houses | ROSSINI (refactored onto the shared adapter, no data change), OSENAT, PBA, GROS_DELETTREZ on the Drouot platform; ADER on its own template. Not Tajan, Piasa, Daguerre, Sotheby's, Christie's (price band or coverage too poor), not Aguttes (its robots.txt bars Anthropic crawlers), not Millon (Cloudflare), not Métayer (no results). |
| Prices | The platform shows either "Résultats sans frais" (Rossini: hammer) or "Résultats avec frais" (the others: with buyer's premium). The adapter reads the label on the page. With-fees prices are stored in `finalCents` and the hammer is derived: `hammerCents = round(finalCents / (1 + rate))`, `rate` from the house configuration (Osenat 0.28, PBA 0.30, Gros & Delettrez 0.30; Ader reads `Frais de vente NN%` printed on each lot and falls back to 0.32). The per-unit ratio gate keeps using the hammer. (My call; rates re-read from each house's conditions of sale during rollout and corrected in the config if needed.) |
| Which sales | Per-house keep regex on the sale title, like Rossini: furniture / objets d'art / intérieurs / design / arts décoratifs / "esprit du XXe" / "grands siècles" / "appartements" / collections; drop bijoux, montres, vins, numismatique, livres, affiches, photographies, mode, automobiles, timbres, autographes, jouets. Each house has its own list in the configuration. "Fewer than 5 lots" rule kept. |
| Years | 2024 to today, like the other houses. |
| Identity | `auction_lots.house` ∈ {ARTCURIAL, ROSSINI, OSENAT, PBA, GROS_DELETTREZ, ADER}; `saleRef`/`lotRef` are the platform's numeric ids. |
| Photos | Drouot CDN `fullHD` variant (`https://cdn.drouot.com/d/lot/fullHD/<houseCdnId>/<saleId>/<hash>`); Rossini switches from `full` to `fullHD` for new lots only (existing rows untouched). House CDN ids: Rossini 62, Osenat 67, PBA 2965 (page paths) — the adapter reads the id from the page's own `phare` URLs rather than from configuration, so no id is hard-coded. |
| Politeness | One fetch at a time per house in the cron (concurrency 1 for PBA, which answered 429 during recon; 3 for the others), one retry on 429 after 5 s. |
| Cron | The daily cron runs every configured house in sequence, budget split as today over `years × houses`. |

## Site facts (verified 31 Oct 2026)

Drouot platform (Rossini, Osenat, PBA, Gros & Delettrez):
- Year list `/<resultsPath>?year=YYYY` (`resultsPath` is `resultats` for Rossini, PBA, Gros & Delettrez and `resultats-ventes-passees` for Osenat): sale cards with title, date line, `a.lien_lot[href="/catalogue/<id>-<slug>"]`.
- Catalogue `/catalogue/<id>?lang=fr&search=&offset=<n>&max=50`, "Lots 1 à 50 sur N".
- Lot `/lot/<saleId>/<lotId>`: `Estimation : a - b EUR`, `Résultat : N EUR` or none, then the label `Résultats sans frais` / `Résultats avec frais`; description; photo hashes under `cdn.drouot.com/d/lot/(phare|small)/<houseCdnId>/<saleId>/<hash>`.
- Sitemaps `sitemap-<id>-fr-sale.xml` / `-lot.xml` exist but are heavy; the year list is enough.

Ader (ader-paris.fr):
- Sales of a year: `sitemap-sales-past-<year>-fr-01.xml` (125 sales in 2025); lots of a year: `sitemap-lots-past-<year>-fr-NN.xml` (5 000 URLs each, ~30k lots in 2025). Sale page `/v/<id>-<slug>` paginated `?page=N#sale-lots`; lot page `/l/<id>-<slug>` showing `Estimation 600 € - 800 € Résultat 1 450 € Frais de vente 32%`, title `Lot n°2 - <title>`, description, photos `cdn.drouot.com/d/lot/fullHD/97/<saleId>/<hash>`. Unsold = no `Résultat`.
- The sale's lots are listed on the sale page; the lot sitemap gives the lot ids per year but not per sale, so the adapter walks the sale page.

## Design

- `src/infrastructure/drouot/DrouotPlatformAdapter.ts` implements `HouseAdapter` from a `DrouotHouseConfig { house, baseUrl, resultsPath, premiumRate, wantedTitle: RegExp, concurrencyHint }`. The Rossini parsers move to `src/infrastructure/drouot/` and lose their Rossini-specific names; `RossiniAdapter` becomes `new DrouotPlatformAdapter(ROSSINI_CONFIG)`. The lot parser also returns `resultIncludesFees: boolean` from the label.
- `src/infrastructure/ader/AderAdapter.ts` with its own parsers and fixtures.
- `src/domain/auction-houses.ts` lists the six houses and labels; `container.auctionIngesters` is built from a `HOUSE_CONFIGS` table; the CLI `--house` accepts the new values; the cron iterates `Object.keys(container.auctionIngesters)`.
- `IngestOptions.concurrency` default comes from the adapter's hint when the CLI flag is absent.

## Non-goals

- Re-pricing existing Rossini rows or changing their photo URLs.
- A house-level premium table editable at runtime (it is code configuration).
- Any house that blocks crawlers or paywalls results.

## Rollout

Per house: dry run of one year → one sale with `--limit 20` (check `lotsSkippedUnsold` under 50 % and a sample hammer against the site) → full 2025 → eval `--house` → 2024, 2026. Deploy once after the code lands; the cron picks the new houses up.
