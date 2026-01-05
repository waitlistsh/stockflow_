/*
  Warnings:

  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Session";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "inventory" INTEGER NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0.0,
    "price" REAL NOT NULL DEFAULT 0.0,
    "leadTime" INTEGER NOT NULL DEFAULT 14
);

-- CreateTable
CREATE TABLE "DailySales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "revenue" REAL NOT NULL,
    "variantId" TEXT NOT NULL,
    CONSTRAINT "DailySales_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "InventoryItem" ("variantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "openaiKey" TEXT,
    "safetyStock" INTEGER NOT NULL DEFAULT 7,
    "useAI" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_variantId_key" ON "InventoryItem"("variantId");

-- CreateIndex
CREATE INDEX "DailySales_variantId_date_idx" ON "DailySales"("variantId", "date");
