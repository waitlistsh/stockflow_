// app/routes/webhooks.orders.create.jsx
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  // 1. Validate that the "ping" is actually from Shopify
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  if (!admin) {
    // If auth fails, return a 400 (Bad Request)
    return new Response();
  }

  console.log(`🔔 Webhook received: ${topic} for shop ${shop}`);

  // 2. Process the Order Data (The payload is the Order JSON)
  const order = payload;
  const orderDate = new Date(order.created_at);
  orderDate.setHours(0, 0, 0, 0); // Normalize to midnight

  // 3. Loop through items in the order
  for (const item of order.line_items) {
    if (!item.variant_id) continue;

    const variantId = String(item.variant_id); // Convert number to string
    const revenue = parseFloat(item.price) * item.quantity;

    // A. Update the Daily Sales Record
    const existingDay = await prisma.dailySales.findFirst({
      where: {
        variantId: variantId,
        date: orderDate,
      }
    });

    if (existingDay) {
      await prisma.dailySales.update({
        where: { id: existingDay.id },
        data: {
          quantitySold: existingDay.quantitySold + item.quantity,
          revenue: existingDay.revenue + revenue
        }
      });
    } else {
      // Only create if we are tracking this item
      const trackedItem = await prisma.inventoryItem.findUnique({
        where: { variantId: variantId }
      });

      if (trackedItem) {
        await prisma.dailySales.create({
          data: {
            date: orderDate,
            variantId: variantId,
            quantitySold: item.quantity,
            revenue: revenue
          }
        });
      }
    }

    // B. Decrement the Stock Level in our DB
    // (Optional: Ideally you'd fetch fresh stock from Shopify, but this is a quick update)
    await prisma.inventoryItem.updateMany({
      where: { variantId: variantId },
      data: {
        inventory: { decrement: item.quantity }
      }
    });
  }

  return new Response();
};