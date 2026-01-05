// app/utils/inventory.js

/**
 * Calculates inventory health with support for Strategic Overrides and Custom Thresholds.
 * @param {number} stock - The current stock level
 * @param {number} velocity - Statistical sales per day (moving average)
 * @param {number|null} override - Manual override velocity (strategic input)
 * @param {object} settings - { riskDaysCritical: number, riskDaysWarning: number }
 */
export const calculateInventoryHealth = (stock, velocity, override, settings) => {
  // 1. Determine Velocity (Use override if provided, otherwise statistical)
  const effectiveVelocity = (override !== null && override !== undefined) ? Number(override) : velocity;

  // 2. Set Thresholds (Use settings if provided, otherwise defaults)
  const CRITICAL_DAYS = settings?.riskDaysCritical || 14;
  const WARNING_DAYS = settings?.riskDaysWarning || 30;

  // 3. OUT OF STOCK CHECK
  if (stock <= 0) {
    return {
      runwayText: '0 Days',
      riskLabel: 'OUT OF STOCK',
      riskColor: 'bg-red-100 text-red-800 border-red-200',
    };
  }

  // 4. STAGNANT CHECK (Stock exists, but no sales)
  if (effectiveVelocity <= 0) {
    return {
      runwayText: 'No Sales',
      riskLabel: 'STAGNANT',
      riskColor: 'bg-gray-100 text-gray-800 border-gray-200',
    };
  }

  // 5. RUNWAY CALCULATION
  const runwayDays = stock / effectiveVelocity;

  if (runwayDays <= CRITICAL_DAYS) {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'HIGH',
      riskColor: 'bg-red-100 text-red-800 border-red-200',
    };
  } else if (runwayDays <= WARNING_DAYS) {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'MEDIUM',
      riskColor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    };
  } else {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'LOW',
      riskColor: 'bg-green-100 text-green-800 border-green-200',
    };
  }
};

/**
 * Syncs products from Shopify to the Database.
 * NOTE: Added 'shop' parameter to correctly associate data.
 */
export async function syncProducts(admin, shop) {
  console.log("📦 Starting Product Sync...");

  // Note: This query fetches only the first 50 products. 
  // For production, you will need to implement pagination (cursor-based) to get all products.
  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50) {
          nodes {
            id, title, vendor, productType
            variants(first: 10) {
              nodes {
                id, sku, price, inventoryQuantity
              }
            }
          }
        }
      }
    `
  );

  const data = await response.json();
  const products = data.data.products.nodes;

  for (const product of products) {
    for (const variant of product.variants.nodes) {
      const cleanVariantId = variant.id.split("/").pop();
      const cleanProductId = product.id.split("/").pop();

      await prisma.inventoryItem.upsert({
        where: { variantId: cleanVariantId },
        update: {
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          vendor: product.vendor,
          category: product.productType,
          // Ensure shop is updated if it somehow changes or was missing
          shop: shop, 
        },
        create: {
          shop: shop, // FIXED: Now uses the actual shop argument
          productId: cleanProductId,
          variantId: cleanVariantId,
          sku: variant.sku || "UNKNOWN",
          title: `${product.title} - ${variant.sku || ''}`,
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          vendor: product.vendor,
          category: product.productType,
          reorderPoint: 5,
        },
      });
    }
  }
  console.log(`✅ Synced ${products.length} products for ${shop}.`);
}