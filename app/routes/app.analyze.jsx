// app/routes/app.analyze.jsx
import { useLoaderData, useNavigation, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProducts, syncOrders } from "../services/inventory.server"; 
import OpenAI from "openai";
import {
  Page, Layout, Card, Text, BlockStack, Banner, Spinner, Box,
  InlineGrid, Divider, IndexTable, Badge, useIndexResourceState
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon } from "@shopify/polaris-icons"; 
import { LineChart, Line, ResponsiveContainer } from 'recharts';

// --- HELPER: Generate Sparkline Data (Last 30 Days) ---
const getSparklineData = (salesHistory) => {
  const data = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    // Find sale for this specific day
    const sale = salesHistory.find(s => {
      const sDate = new Date(s.date);
      return sDate.toDateString() === date.toDateString();
    });

    data.push({ i, val: sale ? sale.quantitySold : 0 });
  }
  return data;
};

// --- ACTION: Handle "Sync & Refresh" Trigger ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  // Run the sync logic
  await syncProducts(admin);
  await syncOrders(admin);
  
  return { status: "success" };
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  // 1. Fetch ALL Inventory with Sales History
  const items = await prisma.inventoryItem.findMany({
    include: {
      sales: {
        where: { date: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } } 
      }
    }
  });

  // 2. Calculate Aggregate KPIs
  let totalStockValue = 0;
  let totalItems = items.length;
  let outOfStockCount = 0;
  let potentialRevenue = 0;
  let highRiskCount = 0;

  const enrichedItems = items.map(item => {
    // KPI Calc
    totalStockValue += (item.inventory * item.cost);
    potentialRevenue += (item.inventory * item.price);
    if (item.inventory <= 0) outOfStockCount++;
    
    // Velocity Calc
    const totalSold = item.sales.reduce((acc, s) => acc + s.quantitySold, 0);
    const velocity = totalSold / 30; // Simple 30-day average
    const runway = velocity > 0 ? item.inventory / velocity : 999;

    if (runway < 14 && item.inventory > 0) highRiskCount++;

    return {
      ...item,
      velocity,
      runway,
      sparkline: getSparklineData(item.sales)
    };
  });

  // 3. AI Executive Report (Aggregate)
  let aiReport = "AI Analysis Unavailable - Check API Key";
  
  if (settings?.openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: settings.openaiKey });
      
      const prompt = `
        Act as a Senior Inventory Manager. Analyze this store's status:
        - Total SKUs: ${totalItems}
        - Stockouts: ${outOfStockCount}
        - High Risk (Low Stock): ${highRiskCount}
        - Total Inventory Cost: $${totalStockValue.toFixed(2)}
        - Potential Revenue: $${potentialRevenue.toFixed(2)}
        
        Provide a "Professional Management Summary" (max 3 sentences) focusing on capital efficiency and immediate risks. 
        Do not use markdown.
      `;

      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-3.5-turbo",
      });
      
      aiReport = completion.choices[0].message.content;
    } catch (err) {
      console.error(err);
      aiReport = "Error generating AI report.";
    }
  }

  // Sort by Risk (Lowest Runway First)
  enrichedItems.sort((a, b) => a.runway - b.runway);

  return { 
    stats: { totalItems, outOfStockCount, totalStockValue, highRiskCount },
    items: enrichedItems,
    aiReport,
    hasKey: !!settings?.openaiKey
  };
};

export default function ProfessionalAnalysis() {
  const { stats, items, aiReport, hasKey } = useLoaderData();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const navigate = useNavigate(); // Hook for navigation
  
  const isSyncing = fetcher.state === "submitting";
  const isLoading = navigation.state === "loading" && !isSyncing;

  // Table Resource Setup
  const resourceName = { singular: 'product', plural: 'products' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(items);

  if (!hasKey) {
    return (
      <Page title="Inventory Report">
        <Banner tone="warning" title="Setup Required">
          Please add your OpenAI API Key in Settings to generate the Executive Report.
        </Banner>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page fullWidth>
        <div style={{height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
           <Spinner size="large" accessibilityLabel="Generating Report" />
        </div>
      </Page>
    );
  }

  // Row Markup
  const rowMarkup = items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index} selected={selectedResources.includes(item.id)}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
        <Text variant="bodySm" tone="subdued">SKU: {item.sku || 'N/A'}</Text>
      </IndexTable.Cell>
      
      <IndexTable.Cell>{item.inventory}</IndexTable.Cell>
      
      {/* SPARKLINE CELL */}
      <IndexTable.Cell>
        <div style={{ width: '100px', height: '30px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={item.sparkline}>
              <Line 
                type="monotone" 
                dataKey="val" 
                stroke="#008060" 
                strokeWidth={2} 
                dot={false} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <Text variant="bodyMd">{item.velocity.toFixed(1)} /day</Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
         {item.runway < 14 ? (
           <Badge tone="critical">{Math.floor(item.runway)} Days Left</Badge>
         ) : item.runway > 90 ? (
           <Badge tone="success">Healthy</Badge>
         ) : (
           <Badge tone="attention">{Math.floor(item.runway)} Days Left</Badge>
         )}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Strategic Inventory Report" 
      fullWidth
      backAction={{ 
        content: "Dashboard", 
        onAction: () => navigate("/app" + window.location.search) 
      }}
      primaryAction={{
        content: 'Sync Data',
        icon: RefreshIcon,
        onAction: () => fetcher.submit({}, { method: "POST" }),
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "Dashboard",
          onAction: () => navigate("/app" + window.location.search),
        },
        {
          content: "Settings",
          icon: SettingsIcon,
          onAction: () => navigate("/app/settings" + window.location.search),
        },
      ]}
    >
      <BlockStack gap="500">
        
        {/* EXECUTIVE SUMMARY CARD */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg" as="h2">Executive Summary</Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <BlockStack gap="200">
                    <Text variant="bodyLg" as="p">{aiReport}</Text>
                    <Text variant="caption" tone="subdued">Powered by OpenAI • {new Date().toLocaleDateString()}</Text>
                  </BlockStack>
                </Box>

                <Divider />

                {/* KPI GRID */}
                <InlineGrid columns={4} gap="400">
                  <Box>
                    <Text variant="headingXs" tone="subdued">TOTAL VALUATION</Text>
                    <Text variant="headingLg">${stats.totalStockValue.toLocaleString()}</Text>
                  </Box>
                  <Box>
                    <Text variant="headingXs" tone="subdued">STOCKOUTS</Text>
                    <Text variant="headingLg" tone={stats.outOfStockCount > 0 ? "critical" : "success"}>
                      {stats.outOfStockCount}
                    </Text>
                  </Box>
                  <Box>
                    <Text variant="headingXs" tone="subdued">HIGH RISK ITEMS</Text>
                    <Text variant="headingLg" tone={stats.highRiskCount > 5 ? "critical" : "attention"}>
                      {stats.highRiskCount}
                    </Text>
                  </Box>
                  <Box>
                    <Text variant="headingXs" tone="subdued">ACTIVE SKUS</Text>
                    <Text variant="headingLg">{stats.totalItems}</Text>
                  </Box>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* FULL INVENTORY TABLE WITH SPARKLINES */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={items.length}
                selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: 'Product Details' },
                  { title: 'Stock' },
                  { title: '30-Day Trend' }, // Sparkline Header
                  { title: 'Velocity' },
                  { title: 'Health Status' },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>

      </BlockStack>
    </Page>
  );
}