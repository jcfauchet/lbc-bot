# Rossini sold lots as photo references — design

**Date:** 2026-10-30
**Context:** The Artcurial fund (spec of the same day) turns sold lots into photo
references. The reseller asked for other houses. Gazette Drouot and drouot.com
paywall their results and forbid crawling; Rossini (Paris, Drouot's "site
générique" platform) publishes hammer prices, estimates, descriptions and photos
on plain server-rendered pages, with robots.txt forbidding only its internal
search. This design adds Rossini as a second house of the same fund.

## Intent

Same alert as Artcurial: an ad whose photos show the same model as a lot Rossini
hammered at ≥ 1.5× the ad price. Everything downstream of ingestion (candidate
gates, Gemini verification, ratio, cap, email, cron) is shared; only the source
adapter is new.

## Decisions

| Question | Decision |
|---|---|
| Which Rossini sales | Sales whose title matches furniture / design / interiors. No specialty field exists on the site, so a keyword rule on the sale title: keep when it matches `/mobilier|objets? d.art|intérieurs?|design|classiques de rossini|collections classiques|arts? de la table/i`; always drop when it matches `/numismatique|bijoux|montres|horlogerie|vins|spiritueux|timbres|autographes|livres|affiches|lithograph|photograph|mode|maroquinerie|jouets|modélisme|or de bourse/i` unless a kept word is also present ("Livres, Timbres, Mobilier, Objets d'Art & Arts de la Table" is kept). (My call; the rule is a constant, easy to tune.) |
| Years | 2024 to today, like Artcurial. Results pages exist per year (`/resultats?year=YYYY`). |
| Which lots | Sold lots only: the lot shows `Résultat : <n> EUR` (hammer, "Résultats sans frais"). Lots without a result are skipped. |
| Identity in the fund | `auction_lots.house = 'ROSSINI'`, `saleRef` = the numeric sale id (e.g. `186362`), `lotRef` = the numeric lot id (e.g. `34122319`), `lotUrl = https://www.rossini.fr/lot/<saleId>/<lotId>`. Same `photo_references` rows, `source = 'ARTCURIAL'` is generalised: `source` becomes `'AUCTION'` for every house (see Data model). |
| Photos | Every photo of the lot from `https://cdn.drouot.com/d/lot/full/62/<saleId>/<hash>` (the `full` variant, ~50 KB; `phare`/`small` are thumbnails). The hashes come from the lot page's `phare` references. |
| Designer / keywords | No structured artist. Keywords stay empty for Rossini lots (the title often starts with "NAME Firstname, dates" for artworks, rarely for furniture; a wrong keyword costs verifications). `name` = lot title. (My call.) |
| Quantity | `parseQuantity(title)` as for Artcurial. |
| Cron | The daily cron also runs Rossini: the yearly results page of the current year, sales dated 2–45 days in the past (sale date is on the year page and the catalogue page), existing lots skipped before fetching. |

## Data model

- `photo_references.source`: the value `'ARTCURIAL'` is renamed `'AUCTION'` by the
  migration (`UPDATE … SET source = 'AUCTION' WHERE source = 'ARTCURIAL'`); every
  query that filtered on `'ARTCURIAL'` filters on `'AUCTION'`; the email and the
  references page read the house from `auction_lots.house` (`Vu chez Artcurial` /
  `Vu chez Rossini`). `ReferenceSource` becomes `'MANUAL' | 'AUCTION'`.
- `auction_lots` unchanged: `house` already exists; `(house, saleRef, lotRef)` unique.
- The fund stats line on the references page shows counts per house.

## Site facts (verified 30 Oct 2026)

- Year page `https://www.rossini.fr/resultats?year=2025`: ~77 sale cards
  (`div.calendrier.entry` with classes `Vente<id>`), each with the sale title
  (`.entry-title`), date line "mercredi 31 décembre 2025 à 14h00", place, and a
  catalogue link `a.lien_lot[href="/catalogue/<id>-<slug>"]`.
- Catalogue `https://www.rossini.fr/catalogue/<id>?lang=fr&search=&offset=<n>&max=50`:
  50 lots per page, "Lots 1 à 50 sur 138"; each card has `/lot/<saleId>/<lotId>`,
  the lot number (`.num_lot`), title (`.product-title`), short description,
  `Estimation : 50 - 80 EUR`, and `Résultat : 40 EUR` when sold (absent or
  "Non vendu" otherwise). A `phare` thumbnail URL per lot.
- Lot page `https://www.rossini.fr/lot/<saleId>/<lotId>`: title, `Lot n° 72`,
  full description with dimensions, `Estimation : 300000 - 500000 EUR`,
  `Résultat : 555 000EUR`, photos as `cdn.drouot.com/d/lot/phare/62/<saleId>/<hash>`
  (6 hashes for the sample lot; `full` serves the large file).
- Pages: 0.2 s, 85–530 KB. robots.txt: `Disallow: /recherche/*` only.
- No Nuxt payload: classic HTML, parsed with regexes/`cheerio`-free string scanning
  like the Artcurial fixtures (no new dependency).

## Ingestion

The `ArtcurialIngester` is generalised into a house-agnostic `AuctionIngester`
driven by a `HouseAdapter`:

```ts
interface HouseAdapter {
  house: 'ARTCURIAL' | 'ROSSINI'
  listSales(year: number): Promise<HouseSale[]>            // id, name, date, specialties/title
  isWantedSale(sale: HouseSale): boolean
  listLotUrls(sale: HouseSale): Promise<string[]>          // may paginate
  lotRefFromUrl(url: string): string
  fetchLot(url: string, sale: HouseSale): Promise<NewAuctionLot | null>  // null unless sold
}
```

The Artcurial behaviour moves into `ArtcurialAdapter` unchanged (sitemap, sale
pages, lot payload). `RossiniAdapter` implements the site facts above. The CLI
gains `--house artcurial|rossini` (default artcurial); the cron runs both
adapters in sequence within the same budget; the report gains `house`.

## Non-goals

- Other houses on the Drouot platform (the adapter shape makes them cheap later).
- Buyer's premium (results are hammer prices, same basis as Artcurial).
- Re-ingesting Artcurial lots; the rename of `source` is the only data change.

## Testing

Fixtures captured from the live site (one year page, one catalogue page with
≥ 50 lots and a second page, one lot page); adapter tests on them; ingester
tests with the fake adapter; the eval CLI unchanged.

## Builder questions, settled (my calls)

- **Gates and cap stay global** (`AUCTION_MIN_SIMILARITY`, `AUCTION_VERIFICATIONS_PER_DAY`); the eval CLI gains `--house` so the Rossini candidate rate can be read on its own before tuning anything per house.
- **Photo URLs**: the stored `urlRemote` is the CDN `full` URL directly
  (`https://cdn.drouot.com/d/lot/full/62/<saleId>/<hash>`), fetched with a plain
  GET and no referer (verified from a terminal); `62` is Rossini's house id on
  the platform and is a constant of the adapter. Hashes are taken only from
  `cdn.drouot.com/d/lot/(phare|small)/62/<saleId>/<hash>` references whose
  `saleId` is the lot's sale, deduplicated, in page order; this excludes banners
  and related lots. If the CDN ever refuses Vercel, the matching stage's
  per-run retry logs it and the alert email shows a broken thumbnail (same risk
  accepted for Artcurial).
- **Ids**: the year card class `Vente<id>`, the catalogue link `/catalogue/<id>-slug`,
  the lot URL `/lot/<id>/<lotId>` and the CDN path `/62/<id>/` all carry the same
  sale id (verified on 174947 and 180689). `saleRef` is that id.
- **Result parsing**: `Résultat : <digits with spaces>EUR` → hammer; anything else
  (absent, "Non vendu", "Retiré", "Préempté" without a figure, 0) → not sold, skipped.
- **Late results**: unsold lots are never stored, so a lot whose result is posted
  after the first pass is fetched again on the next daily run while the sale is in
  the 2–45 day window. Window on the sale date alone (no status on the site).
- **Date parsing**: the French date line (`mercredi 31 décembre 2025 à 14h00`) is
  parsed with a month table; a sale whose date cannot be parsed is skipped by the
  cron (it is still ingested by the yearly CLI, which does not window).
- **Sale filter** adds the Artcurial rule "fewer than 5 lots → skip". Estate
  "intérieurs" sales are kept on purpose: their lots sit in the ad price band.
- **Cron budget**: the 600 s budget is split evenly between the houses; the
  second house also gets whatever the first left unused.
- **Rename and deploy**: the new code treats every `source <> 'MANUAL'` as the
  auction fund, so it works before and after the rename; the migration renames
  `ARTCURIAL` → `AUCTION` in the same deploy. During the few minutes of the build
  the old code finds no auction references and one cron run skips auction
  candidates; accepted.
- **Email**: title and subject read the house name from `auction_lots.house`
  (`Vu chez Artcurial` / `Vu chez Rossini`), carried on `AuctionLotSummary.house`
  (already present).

## Rollout

Migration (source rename) → deploy → `pnpm artcurial:ingest --house rossini --year 2025`
(then 2024, 2026) → eval → watch the cron reports for `house: 'ROSSINI'`.
