-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "inventory" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "leadTime" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySales" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,
    "variantId" TEXT NOT NULL,

    CONSTRAINT "DailySales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "shop" TEXT NOT NULL,
    "openaiKey" TEXT,
    "safetyStock" INTEGER NOT NULL DEFAULT 7,
    "useAI" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_variantId_key" ON "InventoryItem"("variantId");

-- CreateIndex
CREATE INDEX "DailySales_variantId_date_idx" ON "DailySales"("variantId", "date");

-- AddForeignKey
ALTER TABLE "DailySales" ADD CONSTRAINT "DailySales_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "InventoryItem"("variantId") ON DELETE RESTRICT ON UPDATE CASCADE;
