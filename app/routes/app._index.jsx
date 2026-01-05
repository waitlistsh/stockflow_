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
  BlockStack,
  InlineStack,
  Banner
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon } from "@shopify/polaris-icons";

// --- SERVER SIDE ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  await syncProducts(admin); 
  await syncOrders(admin);
  return { status: "success" };
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const items = await prisma.inventoryItem.findMany({ include: { sales: true } });

  const forecastData = items.map(item => {
    const totalSold = item.sales.reduce((sum, day) => sum + day.quantitySold, 0);
    const daysWithData = item.sales.length || 1; 
    const velocity = totalSold / daysWithData; 
    const daysRemaining = velocity > 0 ? Math.round(item.inventory / velocity) : 999;

    return {
      id: item.id, // Needed for Polaris table
      title: item.title,
      inventory: item.inventory,
      velocity: velocity.toFixed(2),
      daysRemaining: daysRemaining,
      riskLevel: daysRemaining < 14 ? "HIGH" : daysRemaining < 30 ? "MEDIUM" : "LOW"
    };
  });

  forecastData.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return { forecastData };
};

// --- FRONTEND UI ---
export default function Index() {
  const { forecastData } = useLoaderData(); 
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const isLoading = fetcher.state === "submitting";

  // Configuration for the Table Columns
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
            {/* AI BUTTON (Only shows if Risk is High/Medium) */}
            {(riskLevel === "HIGH" || riskLevel === "MEDIUM" || true) && ( // remove "|| true" later
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
      <Layout>
        <Layout.Section>
          {forecastData.length === 0 ? (
             <Banner title="Welcome to InventoryFlow" tone="info">
               <p>Click "Sync & Refresh" to pull your latest sales data and calculate risks.</p>
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
    </Page>
  );
}