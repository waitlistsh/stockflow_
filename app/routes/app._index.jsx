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
    const velocity = totalSold / daysWithData; 
    const daysRemaining = velocity > 0 ? Math.round(item.inventory / velocity) : 999;

    return {
      id: item.id,
      title: item.title,
      inventory: item.inventory,
      velocity: velocity.toFixed(2),
      daysRemaining: daysRemaining,
      riskLevel: daysRemaining < 14 ? "HIGH" : daysRemaining < 30 ? "MEDIUM" : "LOW"
    };
  });
  
  forecastData.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // 3. Prepare Chart Data (Sales over Time)
  // We need to group all sales from all products by date
  const salesByDate = {};
  
  items.forEach(item => {
    item.sales.forEach(sale => {
      // Format date as "Jan 05"
      const dateKey = new Date(sale.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      if (!salesByDate[dateKey]) {
        salesByDate[dateKey] = 0;
      }
      salesByDate[dateKey] += sale.revenue;
    });
  });

  // Convert to array for Recharts
  // Take only the last 14 days and sort them
  const chartData = Object.entries(salesByDate)
    .map(([name, value]) => ({ name, sales: value }))
    .slice(-14); 


  if (chartData.length === 0) {
    console.log("⚠️ No real data found. Using dummy data for testing.");
    chartData = [
      { name: "Jan 01", sales: 150 },
      { name: "Jan 02", sales: 200 },
      { name: "Jan 03", sales: 50 },
      { name: "Jan 04", sales: 300 },
      { name: "Jan 05", sales: 120 },
    ];
  }  

  return { forecastData, chartData };
};

// --- FRONTEND UI ---
export default function Index() {
  const { forecastData, chartData } = useLoaderData(); 
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const isLoading = fetcher.state === "submitting";

  const resourceName = { singular: 'product', plural: 'products' };
  
  const rowMarkup = forecastData.map(
    ({ id, title, inventory, velocity, daysRemaining, riskLevel }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">{title}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{inventory}</IndexTable.Cell>
        <IndexTable.Cell>{velocity}/day</IndexTable.Cell>
        <IndexTable.Cell>
          <Text color={daysRemaining < 14 ? "critical" : "success"}>
            {daysRemaining} Days
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack align="start" gap="200">
            <Badge tone={riskLevel === "HIGH" ? "critical" : riskLevel === "MEDIUM" ? "attention" : "success"}>
              {riskLevel}
            </Badge>
            {(riskLevel === "HIGH" || riskLevel === "MEDIUM") && ( 
               <Button 
                 variant="plain" 
                 onClick={() => navigate(`/app/analyze?product=${encodeURIComponent(title)}&velocity=${velocity}&stock=${inventory}`)}
               >
                 🤖 Ask AI
               </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
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
                        <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
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
                        <Bar dataKey="sales" fill="#008060" radius={[4, 4, 0, 0]} />
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