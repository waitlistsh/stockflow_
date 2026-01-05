// app/routes/app._index.jsx
import { useLoaderData, useFetcher, useNavigate, useNavigation } from "react-router"; 
import { authenticate } from "../shopify.server";
import { syncProducts, syncOrders } from "../services/inventory.server";
import prisma from "../db.server";
import OpenAI from "openai"; 
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
  Banner,
  Box,
  Spinner,
  TextField
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon, MagicIcon } from "@shopify/polaris-icons"; 
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { calculateInventoryHealth } from "../utils/inventory.js";





export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // NEW: Handle Strategic Override Save
  if (intent === "update_override") {
    const id = formData.get("id");
    const override = formData.get("override");
    await prisma.inventoryItem.update({
      where: { id },
      data: { overrideVelocity: override ? parseFloat(override) : null }
    });
    return { status: "success" };
  }

  await syncProducts(admin); 
  await syncOrders(admin);
  return { status: "success" };
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request); 

  const [items, settings] = await Promise.all([
    prisma.inventoryItem.findMany({ include: { sales: true } }),
    prisma.merchantSettings.findUnique({ where: { shop: session.shop } })
  ]);

  const forecastData = items.map(item => {
    const totalSold = item.sales.reduce((sum, day) => sum + day.quantitySold, 0);
    const daysWithData = item.sales.length || 1;
    const velocity = totalSold / daysWithData;
    
    // NEW: Pass overrideVelocity to the utility
    const health = calculateInventoryHealth(item.inventory, velocity, item.overrideVelocity);

    return {
      id: item.id,
      name: item.title, 
      stockLevel: item.inventory,
      salesVelocity: velocity,
      overrideVelocity: item.overrideVelocity, // Pass this for the TextField
      health: health,
      daysRemaining: (item.overrideVelocity || velocity) > 0 
        ? item.inventory / (item.overrideVelocity || velocity) 
        : 9999
    };
  });
  
  forecastData.sort((a, b) => a.daysRemaining - b.daysRemaining);

  // 3. Prepare Chart Data (Last 14 Days)
  const chartData = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    chartData.push({ date: dateKey, revenue: 0 });
  }

  items.forEach(item => {
    item.sales.forEach(sale => {
      const saleDate = new Date(sale.date);
      const dateKey = saleDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
      const dayEntry = chartData.find(d => d.date === dateKey);
      if (dayEntry) {
        const revenue = sale.quantitySold * (item.price || 0); 
        dayEntry.revenue += revenue;
      }
    });
  });

  // 4. Dashboard AI Executive Summary
  let aiSummary = null;
  if (settings?.openaiKey && chartData.length > 0) {
    try {
      const openai = new OpenAI({ apiKey: settings.openaiKey });
      const totalRev = chartData.reduce((sum, d) => sum + d.revenue, 0);
      
      const completion = await openai.chat.completions.create({
        messages: [{ 
          role: "user", 
          content: `Act as a retail consultant. Summarize this Shopify store's last 14 days. 
                    Total Revenue: $${totalRev.toFixed(2)}. 
                    Inventory Risks: ${forecastData.filter(i => i.health.riskLabel === 'HIGH').length} items at high risk.
                    Keep it to 2 concise sentences for a dashboard.` 
        }],
        model: "gpt-3.5-turbo",
      });
      aiSummary = completion.choices[0].message.content;
    } catch (err) {
      aiSummary = "AI Summary unavailable. Check your API key in Settings.";
    }
  }

  return { items: forecastData, chartData, aiSummary };
};

export default function Index() {
  const { items: forecastData, chartData, aiSummary } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const navigation = useNavigation();

  // DEFINITION ADDED HERE:
  const isLoading = fetcher.state === "submitting";

  // Navigation Logic
  const isGoingToAnalyze = 
    navigation.state === "loading" && 
    navigation.location.pathname.includes("analyze");

  if (isGoingToAnalyze) {
    return (
      <Page>
        <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '80vh', alignItems: 'center', gap: '20px'}}>
          <Spinner accessibilityLabel="Consulting AI" size="large" />
          <Text variant="headingMd" as="h2">Consulting AI Inventory Expert...</Text>
          <Text tone="subdued">Analyzing velocity and stock levels...</Text>
        </div>
      </Page>
    );
  }


const rowMarkup = forecastData.map((item, index) => { 
    const { id, name, stockLevel, salesVelocity, health, overrideVelocity } = item;
    
    let tone = health.riskLabel === "OUT OF STOCK" || health.riskLabel === "HIGH" ? "critical" : 
               health.riskLabel === "MEDIUM" ? "attention" : "success";

    return (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{name}</Text></IndexTable.Cell>
        <IndexTable.Cell>{stockLevel}</IndexTable.Cell>
        <IndexTable.Cell>{salesVelocity.toFixed(2)}/day</IndexTable.Cell>
        
        {/* STRATEGIC FORECASTING: Manual Override Input */}
        <IndexTable.Cell>
          <div style={{ width: '100px' }}>
            <TextField
              label="Override Velocity"
              labelHidden
              type="number"
              placeholder={salesVelocity.toFixed(2)}
              value={overrideVelocity} 
              suffix="/day"
              autoComplete="off"
              onChange={(val) => {
               
                fetcher.submit(
                  { id: id, override: val, intent: "update_override" },
                  { method: "POST" }
                );
              }}
            />
          </div>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text tone={tone === "attention" ? "warning" : tone}>
            {health.runwayText}
          </Text>
        </IndexTable.Cell>
        
        <IndexTable.Cell>
          <InlineStack align="start" gap="200">
            <Badge tone={tone}>{health.riskLabel}</Badge>
            {(tone === "critical" || tone === "attention") && (
              <Button 
                variant="plain" 
                onClick={() => navigate(`analyze${window.location.search}&product=${encodeURIComponent(name)}&velocity=${salesVelocity}&stock=${stockLevel}`)}
              >
                🤖 Ask AI
              </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
});

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
        content: "Dashboard",
        onAction: () => navigate("/app" + window.location.search),
      },
      {
        content: "Inventory Analysis",
        onAction: () => navigate("/app/analyze" + window.location.search),
      },
      {
        content: "Settings",
        icon: SettingsIcon,
        onAction: () => navigate("/app/settings" + window.location.search),
      },
    ]}
  >
      <BlockStack gap="500">
        
        {aiSummary && (
          <Banner title="Consultant Intelligence" icon={MagicIcon} tone="info">
            <p>{aiSummary}</p>
          </Banner>
        )}

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
                        <YAxis tickFormatter={(value) => `$${value}`} fontSize={12} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: '#f4f6f8' }} formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']} />
                        <Bar dataKey="revenue" fill="#008060" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: 'product', plural: 'products' }}
                itemCount={forecastData.length}
                headings={[{ title: 'Product' }, { title: 'Stock Level' }, { title: 'Sales Velocity' }, { title: 'Runway (Days)' }, { title: 'Risk & Action' }]}
                selectable={false}
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