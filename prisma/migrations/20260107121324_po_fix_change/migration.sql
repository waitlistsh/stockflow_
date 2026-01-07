-- AlterTable
ALTER TABLE "MerchantSettings" ADD COLUMN     "lastPoNumber" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "syncDraftOrders" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "poNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "shopifyDraftId" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);
