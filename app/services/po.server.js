// app/services/po.server.js
import prisma from "../db.server";

/**
 * Creates Internal Purchase Orders.
 * No interaction with Shopify Draft Orders.
 */
export async function createPurchaseOrders(shop, items) {
  // 1. Group items by Vendor
  const groupedItems = items.reduce((acc, item) => {
    const vendor = item.vendor || "Unknown Vendor";
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(item);
    return acc;
  }, {});

  const results = {};

  // 2. Fetch/Init Settings
  let settings = await prisma.merchantSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.merchantSettings.create({
      data: { shop, lastPoNumber: 1000 }
    });
  }

  let currentPoNum = settings.lastPoNumber;

  // 3. Create POs
  for (const [vendor, vendorItems] of Object.entries(groupedItems)) {
    const itemsToOrder = vendorItems.filter(i => (i.quantity || i.suggestedOrderQty) > 0);
    if (itemsToOrder.length === 0) continue;

    currentPoNum++; 
    
    // Calculate total based on what data structure is passed
    const totalCost = itemsToOrder.reduce((sum, i) => {
        const qty = i.quantity !== undefined ? i.quantity : i.suggestedOrderQty;
        return sum + (i.cost * qty);
    }, 0);

    // Sanitize items for storage (snapshot)
    const snapshotItems = itemsToOrder.map(i => ({
        id: i.id,
        sku: i.sku,
        title: i.title,
        cost: i.cost,
        quantity: i.quantity !== undefined ? i.quantity : i.suggestedOrderQty
    }));

    await prisma.purchaseOrder.create({
      data: {
        shop,
        poNumber: currentPoNum,
        vendor,
        totalCost,
        status: "OPEN",
        items: snapshotItems // Save valid JSON
      }
    });

    results[vendor] = `PO-${currentPoNum}`;
  }

  // 4. Increment Counter
  await prisma.merchantSettings.update({
    where: { shop },
    data: { lastPoNumber: currentPoNum }
  });

  return results;
}

/**
 * Updates an existing PO (e.g. from the PO Dashboard).
 */
export async function updatePurchaseOrder(id, items) {
    // items should be [{ title, sku, cost, quantity }]
    const totalCost = items.reduce((sum, i) => sum + (i.cost * i.quantity), 0);
    
    return await prisma.purchaseOrder.update({
        where: { id },
        data: {
            items: items, // Update the JSON snapshot
            totalCost: totalCost
        }
    });
}