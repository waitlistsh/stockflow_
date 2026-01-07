// prisma/seed.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const shop = "current-shop"; // Matches the placeholder in your sync service

  console.log("🌱 Starting seeding...");

  // 1. Create Test Inventory Items
  const items = [
    {
      title: "Organic Cotton T-Shirt - Blue/M",
      sku: "TS-BLUE-M",
      inventory: 12, // High risk (low stock)
      price: 25.0,
      leadTime: 7,
    },
    {
      title: "Eco-Friendly Water Bottle",
      sku: "WB-GREEN",
      inventory: 150, // Low risk (healthy stock)
      price: 15.0,
      leadTime: 14,
    },
    {
      title: "Wireless Bamboo Keyboard",
      sku: "KB-BAMBOO",
      inventory: 5, // High risk (almost out)
      price: 55.0,
      leadTime: 21,
    },
    {
      title: "Recycled Plastic Yoga Mat",
      sku: "YM-GREY",
      inventory: 40, // Medium risk
      price: 45.0,
      leadTime: 10,
    }
  ];

  for (const itemData of items) {
    const variantId = `test-variant-${itemData.sku}`;
    
    const item = await prisma.inventoryItem.upsert({
      where: { variantId },
      update: {},
      create: {
        ...itemData,
        shop,
        variantId,
        productId: `test-product-${itemData.sku}`,
      },
    });

    // 2. Generate 30 Days of Random Sales Data per item
    const salesData = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      date.setHours(0, 0, 0, 0);

      // Random sales between 0 and 5 units per day
      const quantitySold = Math.floor(Math.random() * 6);
      
      if (quantitySold > 0) {
        salesData.push({
          date,
          quantitySold,
          revenue: quantitySold * itemData.price,
          variantId: item.variantId,
        });
      }
    }

    // Insert sales in bulk
    await prisma.dailySales.createMany({
      data: salesData,
      skipDuplicates: true,
    });
  }

  console.log("✅ Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });