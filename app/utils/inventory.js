/**
 * Calculates inventory health with support for Strategic Overrides.
 * @param {number} stock - The current stock level
 * @param {number} velocity - Statistical sales per day (moving average)
 * @param {number|null} override - Manual override velocity (strategic input)
 */
export const calculateInventoryHealth = (stock, velocity, override) => {
  // Use the override velocity if it exists; otherwise, use the statistical average
  const effectiveVelocity = (override !== null && override !== undefined) ? Number(override) : velocity;

  // 1. OUT OF STOCK CHECK
  if (stock <= 0) {
    return {
      runwayText: '0 Days',
      riskLabel: 'OUT OF STOCK',
      riskColor: 'bg-red-100 text-red-800 border-red-200', 
    };
  }

  // 2. STAGNANT CHECK (Stock exists, but no sales after override)
  if (effectiveVelocity <= 0) {
    return {
      runwayText: 'No Sales',
      riskLabel: 'STAGNANT',
      riskColor: 'bg-gray-100 text-gray-800 border-gray-200',
    };
  }
  
  // 3. STANDARD CALCULATION BASED ON EFFECTIVE VELOCITY
  const runwayDays = stock / effectiveVelocity;

  if (runwayDays <= 14) {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'HIGH',
      riskColor: 'bg-red-100 text-red-800 border-red-200',
    };
  } else if (runwayDays <= 30) {
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


export async function syncProducts(admin) {
  console.log("📦 Starting Product Sync...");
  
  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50) {
          nodes {
            id
            title
            vendor       # NEW: Fetch Supplier
            productType  # NEW: Fetch Category
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
          // Update metadata in case it changed on Shopify
          vendor: product.vendor,
          category: product.productType,
        },
        create: {
          shop: "current-shop", 
          productId: cleanProductId,
          variantId: cleanVariantId,
          sku: variant.sku || "UNKNOWN",
          title: `${product.title} - ${variant.sku || ''}`,
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          // Store new fields
          vendor: product.vendor,
          category: product.productType,
          reorderPoint: 5, // Default starting point
        },
      });
    }
  }
  console.log(`✅ Synced ${products.length} products with Metadata.`);
}