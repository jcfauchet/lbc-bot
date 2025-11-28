/*
  Warnings:

  - You are about to drop the column `category` on the `product_listings` table. All the data in the column will be lost.
  - You are about to drop the column `material` on the `product_listings` table. All the data in the column will be lost.
  - You are about to drop the column `period` on the `product_listings` table. All the data in the column will be lost.
  - You are about to drop the column `style` on the `product_listings` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `products` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "product_listings" DROP COLUMN "category",
DROP COLUMN "material",
DROP COLUMN "period",
DROP COLUMN "style",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "periodId" TEXT,
ADD COLUMN     "styleId" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "category",
ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "taxonomy_categories" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_periods" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_materials" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomy_styles" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_styles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_categories_value_key" ON "taxonomy_categories"("value");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_periods_value_key" ON "taxonomy_periods"("value");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_materials_value_key" ON "taxonomy_materials"("value");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomy_styles_value_key" ON "taxonomy_styles"("value");

-- CreateIndex
CREATE INDEX "product_listings_categoryId_idx" ON "product_listings"("categoryId");

-- CreateIndex
CREATE INDEX "product_listings_periodId_idx" ON "product_listings"("periodId");

-- CreateIndex
CREATE INDEX "product_listings_materialId_idx" ON "product_listings"("materialId");

-- CreateIndex
CREATE INDEX "product_listings_styleId_idx" ON "product_listings"("styleId");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "taxonomy_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "taxonomy_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "taxonomy_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "taxonomy_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "taxonomy_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
