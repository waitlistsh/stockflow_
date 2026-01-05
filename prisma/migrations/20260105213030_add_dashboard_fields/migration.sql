-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MerchantSettings" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "riskDaysCritical" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "riskDaysWarning" INTEGER NOT NULL DEFAULT 30;
