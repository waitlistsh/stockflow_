// app/services/po.server.js
import prisma from "../db.server";

/**
 * Creates Purchase Orders for the given items.
 * Groups by Vendor -> Assigns Next PO Number -> Syncs to Shopify (optional)
 */
export async function createPurchaseOrders(admin, shop, items) {
  // 1. Group items by Vendor
  const groupedItems = items.reduce((acc, item) => {
    const vendor = item.vendor || "Unknown Vendor";
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(item);
    return acc;
  }, {});

  const results = {}; // Map: "Vendor Name" -> "PO-1001"

  // 2. Fetch current settings to get start number
  let settings = await prisma.merchantSettings.findUnique({ where: { shop } });
  if (!settings) {
    // Default fallback
    settings = await prisma.merchantSettings.create({
      data: { shop, lastPoNumber: 1000 }
    });
  }

  let currentPoNum = settings.lastPoNumber;

  // 3. Iterate Vendors and Create POs
  for (const [vendor, vendorItems] of Object.entries(groupedItems)) {
    // Only process if there's actually a suggested order qty > 0
    const itemsToOrder = vendorItems.filter(i => i.suggestedOrderQty > 0);
    if (itemsToOrder.length === 0) continue;

    currentPoNum++; // Increment for this vendor
    const poString = `PO-${currentPoNum}`;
    const totalCost = itemsToOrder.reduce((sum, i) => sum + (i.cost * i.suggestedOrderQty), 0);

    // A. Create Internal Record
    await prisma.purchaseOrder.create({
      data: {
        shop,
        poNumber: currentPoNum,
        vendor,
        totalCost,
        status: "OPEN",
        items: itemsToOrder // Storing JSON snapshot
      }
    });

    results[vendor] = poString;

    // B. Sync to Shopify (Draft Order) if enabled
    if (settings.syncDraftOrders) {
      await createDraftOrderInShopify(admin, vendor, poString, itemsToOrder);
    }
  }

  // 4. Update the settings with the new highest number
  await prisma.merchantSettings.update({
    where: { shop },
    data: { lastPoNumber: currentPoNum }
  });

  return results;
}

async function createDraftOrderInShopify(admin, vendor, poNumber, items) {
  const lineItems = items.map(item => ({
    title: item.title,
    originalUnitPrice: item.cost, // PO uses Cost, not Price
    quantity: item.suggestedOrderQty,
    sku: item.sku
  }));

  const response = await admin.graphql(
    `#graphql
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        input: {
          note: `Stockflow Generated Purchase Order: ${poNumber}`,
          tags: ["Purchase Order", "Stockflow", vendor],
          lineItems: lineItems,
          customAttributes: [{ key: "PO_Number", value: poNumber }]
        }
      }
    }
  );

  const data = await response.json();
  if (data.data?.draftOrderCreate?.userErrors?.length > 0) {
    console.error("Failed to sync Draft Order:", data.data.draftOrderCreate.userErrors);
  }
}