// app/services/inventory.server.js
import prisma from "../db.server";

// --- 1. SYNC PRODUCTS ---
export async function syncProducts(admin, shop) {
  console.log("📦 Starting Product Sync...");
  
  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50) {
          nodes {
            id, title, vendor
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
    
    // --- 1. Find or Create Supplier (Robust Upsert) ---
    let supplierId = null;
    
    if (product.vendor) {
      // Because we added @@unique([shop, name]) to schema, we can safely upsert
      const supplier = await prisma.supplier.upsert({
        where: {
          shop_name: {
            shop: shop || "current-shop",
            name: product.vendor
          }
        },
        update: {}, // No changes if exists
        create: {
          shop: shop || "current-shop",
          name: product.vendor,
          leadTime: 14,
        }
      });
      supplierId = supplier.id;
    }

    for (const variant of product.variants.nodes) {
      const cleanVariantId = variant.id.split("/").pop(); 
      const cleanProductId = product.id.split("/").pop();
      
      let finalSku = variant.sku;
      if (!finalSku || finalSku.trim() === "") {
        finalSku = variant.title === "Default Title" 
          ? product.title 
          : `${product.title} - ${variant.title}`;
        finalSku = finalSku.toUpperCase(); 
      }

      const shopifyCost = variant.inventoryItem?.unitCost?.amount 
        ? parseFloat(variant.inventoryItem.unitCost.amount) 
        : 0;

      // Check existing item to preserve manual links if they exist
      const existingItem = await prisma.inventoryItem.findUnique({
        where: { variantId: cleanVariantId }
      });

      const finalSupplierId = existingItem?.supplierId || supplierId;

      await prisma.inventoryItem.upsert({
        where: { variantId: cleanVariantId },
        update: {
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          vendor: product.vendor, // Update text field
          title: `${product.title} - ${variant.sku || ''}`,
          sku: finalSku,
          ...(shopifyCost > 0 ? { cost: shopifyCost } : {}),
          // Only auto-link if it's currently null
          ...(existingItem?.supplierId ? {} : { supplierId: finalSupplierId })
        },
        create: {
          shop: shop || "current-shop", 
          productId: cleanProductId,
          variantId: cleanVariantId,
          sku: finalSku, 
          title: `${product.title} - ${variant.sku || ''}`,
          inventory: variant.inventoryQuantity,
          price: parseFloat(variant.price),
          vendor: product.vendor,
          cost: shopifyCost,
          targetDays: 30,
          supplierId: finalSupplierId
        },
      });
    }
  }
  console.log(`✅ Synced ${products.length} products.`);
}

// --- 2. SYNC SALES HISTORY ---
export async function syncOrders(admin) {
  console.log("💰 Starting Order Sync (Last 60 Days)...");

  const date = new Date();
  date.setDate(date.getDate() - 60);
  const searchDate = date.toISOString();

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

  for (const order of orders) {
    const orderDate = new Date(order.createdAt);
    orderDate.setHours(0, 0, 0, 0);

    for (const item of order.lineItems.nodes) {
      if (!item.variant) continue; 

      const cleanVariantId = item.variant.id.split("/").pop();
      const revenue = parseFloat(item.originalTotalSet.shopMoney.amount);

      const existingRecord = await prisma.dailySales.findFirst({
        where: {
          variantId: cleanVariantId,
          date: orderDate,
        }
      });

      if (existingRecord) {
        await prisma.dailySales.update({
          where: { id: existingRecord.id },
          data: {
            quantitySold: existingRecord.quantitySold + item.quantity,
            revenue: existingRecord.revenue + revenue
          }
        });
      } else {
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