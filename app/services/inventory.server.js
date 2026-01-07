// app/services/inventory.server.js
import prisma from "../db.server";

// --- 1. SYNC PRODUCTS ---
export async function syncProducts(admin, shop) { // Ensure 'shop' is passed if needed, currently app.analyze passes it
  console.log("📦 Starting Product Sync...");
  
  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50) {
          nodes {
            id, title
            variants(first: 10) {
              nodes {
                id, sku, price, inventoryQuantity, title
                inventoryItem {
                  unitCost {
                    amount
                  }
                }
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

      // --- ROADMAP FIX: Fallback for missing SKU ---
      let finalSku = variant.sku;
      if (!finalSku || finalSku === "") {
        // Fallback: Product Title (plus Variant Title if not default)
        finalSku = variant.title === "Default Title" 
          ? product.title 
          : `${product.title}-${variant.title}`;
        
        // Cleanup string (optional)
        finalSku = finalSku.replace(/\s+/g, '-').toUpperCase();
      }

      // --- ROADMAP FIX: Cost Price ---
      // Note: cost might be null in Shopify
      const importedCost = variant.inventoryItem?.unitCost?.amount 
        ? parseFloat(variant.inventoryItem.unitCost.amount) 
        : 0.0;

      await prisma.inventoryItem.upsert({
        where: { variantId: cleanVariantId },
        update: {
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          // Only update cost if Shopify has a non-zero value, 
          // otherwise keep our local value (which might be manually set)
          ...(importedCost > 0 ? { cost: importedCost } : {}),
          title: `${product.title} - ${variant.sku || ''}`,
          sku: finalSku, // Save the cleaned/fallback SKU
        },
        create: {
          shop: shop || "current-shop", 
          productId: cleanProductId,
          variantId: cleanVariantId,
          sku: finalSku,
          title: `${product.title} - ${variant.sku || ''}`,
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          cost: importedCost, // Initialize with imported cost (or 0)
        },
      });
    }
  }
  console.log(`✅ Synced ${products.length} products.`);
}

// --- 2. SYNC SALES HISTORY (The New Part) ---
export async function syncOrders(admin) {
  console.log("💰 Starting Order Sync (Last 60 Days)...");

  // Get date 60 days ago
  const date = new Date();
  date.setDate(date.getDate() - 60);
  const searchDate = date.toISOString();

  // Query Shopify for orders
  const response = await admin.graphql(
    `#graphql
      query getOrders($query: String!) {
        orders(first: 50, query: $query) {
          nodes {
            createdAt
            lineItems(first: 20) {
              nodes {
                variant { id }
                quantity
                originalTotalSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    `,
    { variables: { query: `created_at:>${searchDate}` } }
  );

  const data = await response.json();
  const orders = data.data.orders.nodes;

  // Process orders into the database
  for (const order of orders) {
    const orderDate = new Date(order.createdAt);
    // Normalize time to midnight (so we group by day)
    orderDate.setHours(0, 0, 0, 0);

    for (const item of order.lineItems.nodes) {
      if (!item.variant) continue; // Skip custom items/gift cards

      const cleanVariantId = item.variant.id.split("/").pop();
      const revenue = parseFloat(item.originalTotalSet.shopMoney.amount);

      // Find if we already have a record for this Item + This Day
      const existingRecord = await prisma.dailySales.findFirst({
        where: {
          variantId: cleanVariantId,
          date: orderDate,
        }
      });

      if (existingRecord) {
        // Update existing day
        await prisma.dailySales.update({
          where: { id: existingRecord.id },
          data: {
            quantitySold: existingRecord.quantitySold + item.quantity,
            revenue: existingRecord.revenue + revenue
          }
        });
      } else {
        // Create new day record
        // Only if the variant exists in our DB (Synced first)
        const variantExists = await prisma.inventoryItem.findUnique({
          where: { variantId: cleanVariantId }
        });

        if (variantExists) {
          await prisma.dailySales.create({
            data: {
              date: orderDate,
              variantId: cleanVariantId,
              quantitySold: item.quantity,
              revenue: revenue
            }
          });
        }
      }
    }
  }
  console.log(`✅ Synced sales from ${orders.length} orders.`);
}