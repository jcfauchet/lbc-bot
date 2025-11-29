-- Rename tables to follow domain naming convention

ALTER TABLE "listings" RENAME TO "lbc_product_listings";
ALTER TABLE "product_listings" RENAME TO "reference_product_listings";
ALTER TABLE "products" RENAME TO "reference_normalized_products";
ALTER TABLE "product_sources" RENAME TO "reference_site_sources";

