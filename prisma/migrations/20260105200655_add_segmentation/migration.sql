-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "category" TEXT,
ADD COLUMN     "reorderPoint" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "vendor" TEXT;
