// app/routes/app.analyze.jsx
import { useState, useCallback } from "react";
import { useLoaderData, useNavigation, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProducts, syncOrders } from "../services/inventory.server"; 
import OpenAI from "openai";
import {
  Page, Layout, Card, Text, BlockStack, Banner, Spinner, Box,
  InlineGrid, Divider, IndexTable, Badge, useIndexResourceState, Tooltip,
  Filters, ChoiceList, Select
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon, PinIcon } from "@shopify/polaris-icons"; 
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

// --- ACTION: Handle Sync & Pinning ---
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // 1. SYNC DATA
  if (intent === "sync") {
    // Pass session.shop to ensure we tag items correctly
    await syncProducts(admin, session.shop);
    await syncOrders(admin);
    
    // Update Last Synced Timestamp
    await prisma.merchantSettings.upsert({
      where: { shop: session.shop },
      update: { lastSyncedAt: new Date() },
      create: { shop: session.shop, lastSyncedAt: new Date() }
    });
    return { status: "synced" };
  }

  // 2. PIN/UNPIN ITEM
  if (intent === "pin") {
    const itemId = formData.get("itemId");
    const currentStatus = formData.get("currentStatus") === "true";
    
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { isPinned: !currentStatus }
    });
    return { status: "pinned" };
  }
  
  return null;
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  // Default thresholds if not set in DB
  const riskCritical = settings?.riskDaysCritical || 14;
  const riskWarning = settings?.riskDaysWarning || 30;

  // 1. Fetch ALL Inventory (Sort by Pinned first, then Risk)
  const items = await prisma.inventoryItem.findMany({
    include: {
      sales: {
        where: { date: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } } 
      }
    },
    orderBy: [
      { isPinned: 'desc' }, // Pinned items appear first
      { inventory: 'desc' } // CHANGED: High inventory (likely healthier) first by default
    ]
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
    const velocity = totalSold / 30; 
    
    // CHANGED: Handle OOS runway as -1 for sorting logic (High Health -> OOS)
    let runway;
    if (item.inventory <= 0) {
      runway = -1;
    } else {
      runway = velocity > 0 ? item.inventory / velocity : 999;
    }

    // --- PREDICTIVE ANALYTICS: Calculate Expected Stockout Date ---
    let forecastDate = "Indefinite";
    if (item.inventory <= 0) {
      forecastDate = "Out of Stock";
    } else if (velocity > 0) {
      const today = new Date();
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + runway);
      
      forecastDate = targetDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    }
    // -------------------------------------------------------------

    // Use Custom Thresholds for Stats
    if (runway < riskCritical && item.inventory > 0) highRiskCount++;

    // Determine Status String for Filtering
    let statusLabel = "Healthy";
    if (item.inventory <= 0) statusLabel = "Out of Stock";
    else if (runway < riskCritical) statusLabel = "Critical";
    else if (runway < riskWarning) statusLabel = "Warning";

    return {
      ...item,
      velocity,
      runway,
      forecastDate,
      statusLabel, // Passed to frontend for filtering
      sparkline: getSparklineData(item.sales)
    };
  });

  // 3. AI Executive Report
  let aiReport = "AI Analysis Unavailable - Check API Key";
  
  if (settings?.openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: settings.openaiKey });
      const prompt = `
        Act as a Senior Inventory Manager. Analyze this store's status:
        - Total SKUs: ${totalItems}
        - Stockouts: ${outOfStockCount}
        - High Risk (Low Stock): ${highRiskCount} (Threshold: <${riskCritical} days)
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

  return { 
    stats: { totalItems, outOfStockCount, totalStockValue, highRiskCount },
    items: enrichedItems,
    aiReport,
    settings: { 
      hasKey: !!settings?.openaiKey,
      lastSyncedAt: settings?.lastSyncedAt,
      riskCritical,
      riskWarning
    }
  };
};

export default function ProfessionalAnalysis() {
  const { stats, items, aiReport, settings } = useLoaderData();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const navigate = useNavigate(); 
  
  const isSyncing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "sync";
  const isLoading = navigation.state === "loading" && !isSyncing;

  // --- 1. STATE ---
  const [queryValue, setQueryValue] = useState("");
  const [selectedStatus, setSelectedStatus] = useState([]);
  // CHANGED: Default sort to High Runway (Healthy) -> Low Runway (Critical) -> OOS
  const [sortSelected, setSortSelected] = useState(["runway desc"]);

  // --- 2. HANDLERS ---
  const handleQueryValueChange = useCallback((value) => setQueryValue(value), []);
  const handleStatusChange = useCallback((value) => setSelectedStatus(value), []);
  const handleQueryValueRemove = useCallback(() => setQueryValue(""), []);
  const handleStatusRemove = useCallback(() => setSelectedStatus([]), []);
  const handleFiltersClearAll = useCallback(() => {
    handleQueryValueRemove();
    handleStatusRemove();
  }, [handleQueryValueRemove, handleStatusRemove]);

  const onSort = useCallback((headingIndex, direction) => {
    const mapping = {
      0: 'title',
      1: 'inventory',
      3: 'velocity',
      4: 'forecastDate', 
      5: 'runway' 
    };
    const key = mapping[headingIndex];
    if (key) {
      setSortSelected([`${key} ${direction}`]);
    }
  }, []);

  const handleSortChange = useCallback((value) => setSortSelected([value]), []);

  const sortOptions = [
    {label: 'Health: High to Low', value: 'runway desc'},
    {label: 'Health: Low to High', value: 'runway asc'},
    {label: 'Inventory: High to Low', value: 'inventory desc'},
    {label: 'Inventory: Low to High', value: 'inventory asc'},
    {label: 'Velocity: High to Low', value: 'velocity desc'},
  ];

  // --- 3. FILTERING (Must come FIRST) ---
  const filteredItems = items.filter((item) => {
    // Text Search (Title or SKU)
    const matchText = item.title.toLowerCase().includes(queryValue.toLowerCase()) || 
                      (item.sku && item.sku.toLowerCase().includes(queryValue.toLowerCase()));
    
    // Status Filter
    const matchStatus = selectedStatus.length === 0 || selectedStatus.includes(item.statusLabel);

    return matchText && matchStatus;
  });

  // --- 4. SORTING (Must come AFTER filtering) ---
  const sortedItems = [...filteredItems].sort((a, b) => {
    const [sortKey, sortDirection] = sortSelected[0].split(" ");
    let valA = a[sortKey];
    let valB = b[sortKey];

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // --- 5. SELECTION STATE (Use sorted items) ---
  const resourceName = { singular: 'product', plural: 'products' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(sortedItems);

  // Filters Configuration
  const filters = [
    {
      key: 'status',
      label: 'Health Status',
      filter: (
        <ChoiceList
          title="Health Status"
          titleHidden
          choices={[
            { label: 'Out of Stock', value: 'Out of Stock' },
            { label: 'Critical Risk', value: 'Critical' },
            { label: 'Warning', value: 'Warning' },
            { label: 'Healthy', value: 'Healthy' },
          ]}
          selected={selectedStatus}
          onChange={handleStatusChange}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [];
  if (selectedStatus.length > 0) {
    appliedFilters.push({
      key: 'status',
      label: `Status: ${selectedStatus.join(', ')}`,
      onRemove: handleStatusRemove,
    });
  }

  // --- HELPER: Dynamic Status Badge ---
  const getStatusBadge = (item) => {
    if (item.statusLabel === "Out of Stock") return <Badge tone="critical">Out of Stock</Badge>;
    if (item.statusLabel === "Critical") return <Badge tone="critical">{Math.floor(item.runway)} Days (Critical)</Badge>;
    if (item.statusLabel === "Warning") return <Badge tone="attention">{Math.floor(item.runway)} Days (Warning)</Badge>;
    return <Badge tone="success">Healthy</Badge>;
  };

  if (!settings.hasKey) {
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

  // Row Markup (Iterate over sortedItems)
  const rowMarkup = sortedItems.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index} selected={selectedResources.includes(item.id)}>
      <IndexTable.Cell>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          {/* PIN BUTTON */}
          <Tooltip content={item.isPinned ? "Unpin product" : "Pin to top"}>
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Prevent row selection
                fetcher.submit({ intent: "pin", itemId: item.id, currentStatus: item.isPinned }, { method: "POST" });
              }}
              style={{ 
                background: 'none', border: 'none', cursor: 'pointer', 
                color: item.isPinned ? '#008060' : '#babfc3',
                display: 'flex', alignItems: 'center'
              }}
            >
              <PinIcon width={20} />
            </button>
          </Tooltip>
          
          <BlockStack gap="050">
             <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
             <Text variant="bodySm" tone="subdued">SKU: {item.sku || 'N/A'}</Text>
          </BlockStack>
        </div>
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

      {/* PREDICTIVE ANALYTICS CELL */}
      <IndexTable.Cell>
         <Text variant="bodyMd" tone={item.runway < settings.riskCritical ? "critical" : "subdued"}>
           {item.forecastDate}
         </Text>
      </IndexTable.Cell>

      {/* DYNAMIC HEALTH STATUS CELL */}
      <IndexTable.Cell>
         {getStatusBadge(item)}
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const lastSynced = settings.lastSyncedAt 
  ? new Date(settings.lastSyncedAt).toLocaleString() 
  : "Never";

  return (
    <Page 
      title="Strategic Inventory Report" 
      fullWidth
      backAction={{ 
        content: "Dashboard", 
        onAction: () => navigate("/app" + window.location.search) 
      }}
      primaryAction={{
        content: isSyncing ? 'Syncing...' : 'Sync Data',
        icon: RefreshIcon,
        onAction: () => fetcher.submit({ intent: "sync" }, { method: "POST" }),
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
        
        {/* REAL-TIME STATUS BANNER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 1rem' }}>
           <Text variant="bodySm" tone="subdued">
             Risk Thresholds: &lt;{settings.riskCritical} days (Critical), &lt;{settings.riskWarning} days (Warning)
           </Text>
           <Text variant="bodySm" tone={isSyncing ? "success" : "subdued"}>
             {isSyncing ? "↻ Syncing live data..." : `✓ Last Synced: ${lastSynced}`}
           </Text>
        </div>

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

        {/* FULL INVENTORY TABLE */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px' }}>
                <div style={{ flex: 1 }}>
                  {/* FILTERS COMPONENT */}
                  <Filters
                    queryValue={queryValue}
                    filters={filters}
                    appliedFilters={appliedFilters}
                    onQueryChange={handleQueryValueChange}
                    onQueryClear={handleQueryValueRemove}
                    onClearAll={handleFiltersClearAll}
                  />
                </div>
                
                {/* SORTING DROPDOWN */}
                <div style={{ width: '200px' }}>
                   <Select
                     label="Sort by"
                     labelInline
                     options={sortOptions}
                     onChange={handleSortChange}
                     value={sortSelected[0]}
                   />
                </div>
              </div>
              
              <IndexTable
                resourceName={resourceName}
                itemCount={sortedItems.length}
                selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                sortable={[true, true, false, true, true, true]} 
                sortSelected={sortSelected}
                onSort={onSort}
                headings={[
                  { title: 'Product' },
                  { title: 'Stock' },
                  { title: 'Trend' }, 
                  { title: 'Velocity' },
                  { title: 'Stockout Date' },
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