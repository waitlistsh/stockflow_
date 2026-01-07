// app/routes/app._index.jsx
import { useState, useCallback, useEffect } from "react"; // Added React hooks
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

// --- NEW COMPONENT: Handles Local State for Override Input ---
function OverrideCell({ id, value: initialValue, placeholder, onSave }) {
  const [value, setValue] = useState(initialValue);

  // Sync with server data if it changes externally
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = useCallback((newValue) => setValue(newValue), []);

  const handleBlur = useCallback(() => {
    // Only submit if the value is different from what we started with
    if (String(value) !== String(initialValue)) {
      onSave(id, value);
    }
  }, [id, value, initialValue, onSave]);

  return (
    <div style={{ width: '120px' }} onClick={(e) => e.stopPropagation()}>
      <TextField
        label="Override Velocity"
        labelHidden
        type="number"
        placeholder={placeholder}
        value={value ? String(value) : ""} 
        suffix="/day"
        autoComplete="off"
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  );
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Handle Strategic Override Save
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
    
    // Pass overrideVelocity to the utility
    const health = calculateInventoryHealth(item.inventory, velocity, item.overrideVelocity);

    return {
      id: item.id,
      name: item.title, 
      stockLevel: item.inventory,
      salesVelocity: velocity,
      overrideVelocity: item.overrideVelocity, 
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

  const isLoading = fetcher.state === "submitting";

  // Navigation Logic
  const isGoingToAnalyze = 
    navigation.state === "loading" && 
    navigation.location.pathname.includes("analyze");

  if (isGoingToAnalyze) {
    return (
      <Page fullWidth>
        <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '80vh', alignItems: 'center', gap: '20px'}}>
          <Spinner accessibilityLabel="Consulting AI" size="large" />
          <Text variant="headingMd" as="h2">Consulting AI Inventory Expert...</Text>
          <Text tone="subdued">Analyzing velocity and stock levels...</Text>
        </div>
      </Page>
    );
  }

  // --- HANDLER: Trigger Fetcher on Save ---
  const handleOverrideSave = (id, newVal) => {
    fetcher.submit(
      { id: id, override: newVal, intent: "update_override" },
      { method: "POST" }
    );
  };

  const rowMarkup = forecastData.map((item, index) => { 
    const { id, name, stockLevel, salesVelocity, health, overrideVelocity } = item;
    
    let tone = health.riskLabel === "OUT OF STOCK" || health.riskLabel === "HIGH" ? "critical" : 
               health.riskLabel === "MEDIUM" ? "attention" : "success";

    return (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{name}</Text></IndexTable.Cell>
        <IndexTable.Cell>{stockLevel}</IndexTable.Cell>
        <IndexTable.Cell>{salesVelocity.toFixed(2)}/day</IndexTable.Cell>
        
        {/* STRATEGIC FORECASTING: Manual Override Input (Using New Component) */}
        <IndexTable.Cell>
          <OverrideCell 
            id={id}
            value={overrideVelocity}
            placeholder={salesVelocity.toFixed(2)}
            onSave={handleOverrideSave}
          />
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
                onClick={() => {
                  const analysisParams = new URLSearchParams({
                    product: name,
                    velocity: salesVelocity.toFixed(2),
                    stock: stockLevel.toString()
                  });

                  const currentParams = new URLSearchParams(window.location.search);
                  analysisParams.forEach((value, key) => currentParams.set(key, value));
                  navigate(`analyze?${currentParams.toString()}`);
                }}
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
    fullWidth // FIXED: Makes the whole page wider
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
        content: "Supplier Management",
        onAction: () => navigate("/app/suppliers" + window.location.search),
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
                headings={[
                  { title: 'Product' }, 
                  { title: 'Stock Level' }, 
                  { title: 'Sales Velocity' }, 
                  { title: 'Override - # of items per day' },        
                  { title: 'Runway (Days)' },   
                  { title: 'Risk & Action' }   
                ]}
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