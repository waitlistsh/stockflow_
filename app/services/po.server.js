// app/services/po.server.js
import prisma from "../db.server";

export async function createPurchaseOrders(shop, items) {
  // ... (Keep existing create logic unchanged) ...
  // 1. Group items by Vendor
  const groupedItems = items.reduce((acc, item) => {
    const vendor = item.vendor || "Unknown Vendor";
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(item);
    return acc;
  }, {});

  const results = {};

  let settings = await prisma.merchantSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.merchantSettings.create({
      data: { shop, lastPoNumber: 1000 }
    });
  }

  let currentPoNum = settings.lastPoNumber;

  for (const [vendor, vendorItems] of Object.entries(groupedItems)) {
    const itemsToOrder = vendorItems.filter(i => (i.quantity || i.suggestedOrderQty) > 0);
    if (itemsToOrder.length === 0) continue;

    currentPoNum++; 
    
    const supplier = await prisma.supplier.findFirst({
      where: { shop, name: vendor }
    });

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
        vendorAddress: supplier?.address,
        paymentTerms: supplier?.paymentTerms,
        totalCost,
        status: "OPEN",
        items: snapshotItems 
      }
    });

    results[vendor] = `PO-${currentPoNum}`;
  }

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

// --- UPDATED: Receive Function with Error Handling ---
export async function receivePurchaseOrder(admin, shop, poId) {
  try {
    // 1. Fetch PO
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) return { error: "PO not found" };
    if (po.status === "RECEIVED") return { error: "PO already received" };

    // 2. Get Shop Location
    const locResponse = await admin.graphql(
      `#graphql
        query {
          locations(first: 1) {
            nodes { id, name }
          }
        }
      `
    );
    const locJson = await locResponse.json();
    
    // CHECK FOR PERMISSION ERRORS
    if (locJson.errors) {
        console.error("GraphQL Error:", locJson.errors);
        return { error: "Permission Error: Need 'read_locations' scope. Please restart app." };
    }

    const locationId = locJson.data?.locations?.nodes?.[0]?.id;
    if (!locationId) return { error: "No location found in Shopify." };

    // 3. Process Items
    let updatedCount = 0;
    
    for (const item of po.items) {
        // Find local item to get Variant ID
        const localItem = await prisma.inventoryItem.findFirst({
            where: {
                shop,
                OR: [{ sku: item.sku }, { title: item.title }]
            }
        });

        if (!localItem?.variantId) {
            console.warn(`Skipping item: ${item.sku} - Not found locally`);
            continue;
        }

        const variantId = `gid://shopify/ProductVariant/${localItem.variantId}`;

        // Get InventoryItem ID
        const variantResponse = await admin.graphql(
            `#graphql
            query getInvItem($id: ID!) {
                productVariant(id: $id) {
                    inventoryItem { id }
                }
            }`,
            { variables: { id: variantId } }
        );
        const variantData = await variantResponse.json();
        const inventoryItemId = variantData.data?.productVariant?.inventoryItem?.id;

        if (inventoryItemId) {
            // Adjust Inventory
            const adjustResponse = await admin.graphql(
                `#graphql
                mutation adjustStock($input: InventoryAdjustQuantitiesInput!) {
                    inventoryAdjustQuantities(input: $input) {
                        userErrors { field message }
                    }
                }`,
                {
                    variables: {
                        input: {
                            reason: "received_transfer",
                            name: "available",
                            changes: [{
                                inventoryItemId,
                                locationId,
                                delta: parseInt(item.quantity)
                            }]
                        }
                    }
                }
            );
            
            const adjustJson = await adjustResponse.json();
            if (adjustJson.data?.inventoryAdjustQuantities?.userErrors?.length > 0) {
                console.error("Adjustment Error:", adjustJson.data.inventoryAdjustQuantities.userErrors);
            } else {
                updatedCount++;
            }
        }

        // Update Local DB
        await prisma.inventoryItem.update({
            where: { id: localItem.id },
            data: { inventory: { increment: parseInt(item.quantity) } }
        });
    }

    // 4. Mark PO as Received
    await prisma.purchaseOrder.update({
        where: { id: poId },
        data: { status: "RECEIVED" }
    });

    return { success: true, count: updatedCount };

  } catch (err) {
    console.error("Receive PO Failed:", err);
    return { error: err.message };
  }
}