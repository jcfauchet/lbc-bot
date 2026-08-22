-- Two tables nothing reads.
--
-- listing_labels never held a row. Its repository was built in the DI
-- container but no use case ever called it -- scaffolding for a labelling
-- feature that was not finished.
--
-- categories held 23 rows: a hand-curated furniture taxonomy (table_basse,
-- guéridon, objet_déco, ...). Nothing consumed it either --
-- ITaxonomyRepository.getCategories() had no caller, and the listing category
-- filter the scraper actually applies comes from the
-- CATEGORIES_TO_EXCLUDE_FROM_LBC constant, not from this table. The 23 values
-- are not lost with the table: they were seeded from prisma/seed.ts, so they
-- stay in git history alongside this commit.
DROP TABLE "listing_labels";
DROP TABLE "categories";
