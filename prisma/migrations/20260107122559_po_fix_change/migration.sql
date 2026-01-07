/*
  Warnings:

  - You are about to drop the column `syncDraftOrders` on the `MerchantSettings` table. All the data in the column will be lost.
  - You are about to drop the column `shopifyDraftId` on the `PurchaseOrder` table. All the data in the column will be lost.
  - Added the required column `items` to the `PurchaseOrder` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MerchantSettings" DROP COLUMN "syncDraftOrders";

-- AlterTable
ALTER TABLE "PurchaseOrder" DROP COLUMN "shopifyDraftId",
ADD COLUMN     "items" JSONB NOT NULL;
