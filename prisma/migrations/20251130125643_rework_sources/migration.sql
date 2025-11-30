/*
  Warnings:

  - You are about to drop the `price_history` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `product_images` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reference_normalized_products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reference_product_listings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reference_site_sources` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `taxonomy_categories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `taxonomy_materials` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `taxonomy_periods` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `taxonomy_styles` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "price_history" DROP CONSTRAINT "price_history_productId_fkey";

-- DropForeignKey
ALTER TABLE "price_history" DROP CONSTRAINT "price_history_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_listingId_fkey";

-- DropForeignKey
ALTER TABLE "product_images" DROP CONSTRAINT "product_images_productId_fkey";

-- DropForeignKey
ALTER TABLE "reference_normalized_products" DROP CONSTRAINT "products_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_materialId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_periodId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_productId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "reference_product_listings" DROP CONSTRAINT "product_listings_styleId_fkey";

-- AlterTable
ALTER TABLE "ai_analyses" ADD COLUMN     "bestMatchSource" TEXT;

-- AlterTable
ALTER TABLE "lbc_product_listings" RENAME CONSTRAINT "listings_pkey" TO "lbc_product_listings_pkey";

-- DropTable
DROP TABLE "price_history";

-- DropTable
DROP TABLE "product_images";

-- DropTable
DROP TABLE "reference_normalized_products";

-- DropTable
DROP TABLE "reference_product_listings";

-- DropTable
DROP TABLE "reference_site_sources";

-- DropTable
DROP TABLE "taxonomy_categories";

-- DropTable
DROP TABLE "taxonomy_materials";

-- DropTable
DROP TABLE "taxonomy_periods";

-- DropTable
DROP TABLE "taxonomy_styles";

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_value_key" ON "categories"("value");

-- CreateIndex
CREATE INDEX "ai_analyses_bestMatchSource_idx" ON "ai_analyses"("bestMatchSource");

-- RenameForeignKey
ALTER TABLE "lbc_product_listings" RENAME CONSTRAINT "listings_searchId_fkey" TO "lbc_product_listings_searchId_fkey";

-- RenameIndex
ALTER INDEX "listings_lbcId_idx" RENAME TO "lbc_product_listings_lbcId_idx";

-- RenameIndex
ALTER INDEX "listings_lbcId_key" RENAME TO "lbc_product_listings_lbcId_key";

-- RenameIndex
ALTER INDEX "listings_publishedAt_idx" RENAME TO "lbc_product_listings_publishedAt_idx";

-- RenameIndex
ALTER INDEX "listings_searchId_idx" RENAME TO "lbc_product_listings_searchId_idx";

-- RenameIndex
ALTER INDEX "listings_status_idx" RENAME TO "lbc_product_listings_status_idx";
