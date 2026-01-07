// app/services/po.server.js
import prisma from "../db.server";

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
    
    // --- NEW: Fetch Supplier Details ---
    const supplier = await prisma.supplier.findFirst({
      where: { shop, name: vendor }
    });
    // -----------------------------------

    const totalCost = itemsToOrder.reduce((sum, i) => {
        const qty = i.quantity !== undefined ? i.quantity : i.suggestedOrderQty;
        return sum + (i.cost * qty);
    }, 0);

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
        // --- NEW: Save Snapshot ---
        vendorAddress: supplier?.address,
        paymentTerms: supplier?.paymentTerms,
        // --------------------------
        totalCost,
        status: "OPEN",
        items: snapshotItems 
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

export async function updatePurchaseOrder(id, items) {
    const totalCost = items.reduce((sum, i) => sum + (i.cost * i.quantity), 0);
    return await prisma.purchaseOrder.update({
        where: { id },
        data: { items: items, totalCost: totalCost }
    });
}


export async function receivePurchaseOrder(admin, shop, poId) {
  // 1. Fetch the PO to get the items
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId }
  });

  if (!po || po.status === "RECEIVED") return;

  // 2. Update each item's inventory in your database
  for (const item of po.items) {
    // We match by SKU or Title to find the item in your InventoryItem table
    await prisma.inventoryItem.updateMany({
      where: { 
        shop,
        OR: [
          { sku: item.sku },
          { title: item.title }
        ]
      },
      data: {
        inventory: {
          increment: item.quantity
        }
      }
    });
  }

  // 3. Mark the PO as RECEIVED so it can't be received twice
  return await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: "RECEIVED" }
  });
}