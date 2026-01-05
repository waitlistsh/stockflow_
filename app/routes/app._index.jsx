// app/routes/app._index.jsx
import { useLoaderData, useFetcher, useNavigate } from "react-router"; 
import { authenticate } from "../shopify.server";
import { syncProducts, syncOrders } from "../services/inventory.server";
import prisma from "../db.server";
import { 
  Page, 
  Layout, 
  Card, 
  IndexTable, 
  Text, 
  Badge, 
  Button, 
  InlineStack,
  BlockStack,
  Banner
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon } from "@shopify/polaris-icons";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { calculateInventoryHealth } from "../utils/inventory.js";


// --- SERVER SIDE ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  await syncProducts(admin); 
  await syncOrders(admin);
  return { status: "success" };
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // 1. Fetch Items & Sales
  const items = await prisma.inventoryItem.findMany({ include: { sales: true } });

  // 2. Prepare Table Data (Risk Analysis)
  const forecastData = items.map(item => {
  const totalSold = item.sales.reduce((sum, day) => sum + day.quantitySold, 0);
  const daysWithData = item.sales.length || 1;
  
  // A. Calculate Velocity
  const velocity = totalSold / daysWithData;

  // B. USE YOUR IMPORT HERE (This fixes the grey text!)
  const health = calculateInventoryHealth(item.inventory, velocity); // Note: using item.inventory
  const rawRunway = velocity > 0 ? item.stockLevel / velocity : 9999;

  return {
  id: item.id,
  
  // 1. Map DB 'title' to Frontend 'name'
  name: item.title, 
  
  // 2. Map DB 'inventory' to Frontend 'stockLevel'
  stockLevel: item.inventory,
  
  // 3. Pass the calculated velocity
  salesVelocity: velocity,
  
  // 4. Pass the full health object (CRITICAL for badges!)
  health: health,
  
  // 5. Keep this for sorting
  daysRemaining: velocity > 0 ? item.inventory / velocity : 9999
};
});
  
  forecastData.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // 3. Prepare Chart Data (Last 14 Days with Zero-Filling)
  const chartData = [];
  const today = new Date();

  // A. Generate the last 14 days (so the X-Axis is always full)
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    
    // Format as "Jan 05" to match your chart
    const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    
    chartData.push({ date: dateKey, revenue: 0 });
  }

  // B. Fill in the actual revenue
  items.forEach(item => {
    item.sales.forEach(sale => {
      const saleDate = new Date(sale.date);
      const dateKey = saleDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      
      // Find the matching day in our empty chart
      const dayEntry = chartData.find(d => d.date === dateKey);
      
      if (dayEntry) {
        // Calculate revenue (Price * Quantity)
        // Note: Make sure your DB has a price! If not, we default to 0 to prevent errors.
        const revenue = sale.quantitySold * (item.price || 0); 
        dayEntry.revenue += revenue;
      }
    });
  });

  return { items: forecastData, chartData };
};

// --- FRONTEND UI ---
export default function Index() {
  const { items: forecastData, chartData } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const isLoading = fetcher.state === "submitting";

  const resourceName = { singular: 'product', plural: 'products' };
  
 const rowMarkup = forecastData.map(
    ({ id, name, stockLevel, salesVelocity, health }, index) => {
      // 1. Map our Risk Labels to Shopify Polaris Tones
      let tone = "success";
      if (health.riskLabel === "OUT OF STOCK" || health.riskLabel === "HIGH") {
        tone = "critical";
      } else if (health.riskLabel === "MEDIUM") {
        tone = "attention";
      } else if (health.riskLabel === "STAGNANT") {
        tone = "info";
      }

      return (
        <IndexTable.Row id={id} key={id} position={index}>
          <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {name}
            </Text>
          </IndexTable.Cell>
          
          <IndexTable.Cell>{stockLevel}</IndexTable.Cell>
          
          <IndexTable.Cell>{salesVelocity.toFixed(2)}/day</IndexTable.Cell>
          
          <IndexTable.Cell>
            {/* Display the text calculated in the loader (e.g. "0 Days", "No Sales") */}
            <Text tone={tone === "attention" ? "warning" : tone}>
              {health.runwayText}
            </Text>
          </IndexTable.Cell>
          
          <IndexTable.Cell>
            <InlineStack align="start" gap="200">
              <Badge tone={tone}>{health.riskLabel}</Badge>
              
              {/* Show 'Ask AI' button if Risk is High, Medium, or Out of Stock */}
              {(tone === "critical" || tone === "attention") && (
                <Button
                  variant="plain"
                  onClick={() =>
                    navigate(
                      `/app/analyze?product=${encodeURIComponent(
                        name
                      )}&velocity=${salesVelocity}&stock=${stockLevel}`
                    )
                  }
                >
                  🤖 Ask AI
                </Button>
              )}
            </InlineStack>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page 
      title="Inventory Forecast" 
      primaryAction={
        <Button 
          icon={RefreshIcon} 
          variant="primary" 
          loading={isLoading} 
          onClick={() => fetcher.submit({}, { method: "POST" })}
        >
          Sync & Refresh
        </Button>
      }
      secondaryActions={[
        {
          content: "Settings",
          icon: SettingsIcon,
          onAction: () => navigate("/app/settings")
        }
      ]}
    >
      <BlockStack gap="500">
        
        {/* SECTION 1: THE CHART */}
        {chartData.length > 0 && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Total Revenue (Last 14 Days)</Text>
                  <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis 
                          tickFormatter={(value) => `$${value}`} 
                          fontSize={12} 
                          tickLine={false} 
                          axisLine={false} 
                        />
                        <Tooltip 
                          cursor={{ fill: '#f4f6f8' }}
                          formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']}
                        />
                        <Bar dataKey="revenue" fill="#008060" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        {/* SECTION 2: THE TABLE */}
        <Layout>
          <Layout.Section>
            {forecastData.length === 0 ? (
               <Banner title="Welcome to Stockflow" tone="info">
                 <p>Click "Sync & Refresh" to pull your latest sales data.</p>
               </Banner>
            ) : (
              <Card padding="0">
                <IndexTable
                  resourceName={resourceName}
                  itemCount={forecastData.length}
                  headings={[
                    { title: 'Product' },
                    { title: 'Stock Level' },
                    { title: 'Sales Velocity' },
                    { title: 'Runway (Days)' },
                    { title: 'Risk & Action' },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}