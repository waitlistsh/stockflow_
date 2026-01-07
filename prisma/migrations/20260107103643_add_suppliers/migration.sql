-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "contactName" TEXT,
    "leadTime" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_vendor_fkey" FOREIGN KEY ("vendor") REFERENCES "Supplier"("name") ON DELETE SET NULL ON UPDATE CASCADE;
