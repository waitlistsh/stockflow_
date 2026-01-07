// app/routes/app.analyze.jsx
import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useNavigation, useFetcher, useNavigate, useLocation } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncProducts, syncOrders } from "../services/inventory.server"; 
import { createPurchaseOrders } from "../services/po.server"; 
import OpenAI from "openai";
import {
  Page, Layout, Card, Text, BlockStack, Banner, Spinner, Box,
  InlineGrid, Divider, IndexTable, Badge, useIndexResourceState, Tooltip,
  Filters, ChoiceList, Select, TextField, Button, ButtonGroup, Modal
} from "@shopify/polaris";
import { RefreshIcon, SettingsIcon, PinIcon, PageDownIcon, DiscountIcon } from "@shopify/polaris-icons"; 
import { LineChart, Line, ResponsiveContainer } from 'recharts';

// --- HELPER COMPONENT: STABLE EDITABLE CELL ---
function EditableCell({ value: initialValue, onSave, prefix = "", type = "text" }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = useCallback((newValue) => setValue(newValue), []);
  
  const handleBlur = useCallback(() => {
    if (String(value) !== String(initialValue)) {
      onSave(value);
    }
  }, [value, initialValue, onSave]);

  return (
    <div style={{ minWidth: '80px' }} onClick={(e) => e.stopPropagation()}>
      <TextField
        type={type} 
        value={String(value)}
        onChange={handleChange}
        onBlur={handleBlur}
        autoComplete="off"
        label="Edit"
        labelHidden
        prefix={prefix}
      />
    </div>
  );
}

const getSparklineData = (salesHistory) => {
  const data = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const sale = salesHistory.find(s => {
      const sDate = new Date(s.date);
      return sDate.toDateString() === date.toDateString();
    });

    data.push({ i, val: sale ? sale.quantitySold : 0 });
  }
  return data;
};

// --- BACKEND ACTION HANDLER ---
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    await syncProducts(admin, session.shop);
    await syncOrders(admin);
    await prisma.merchantSettings.upsert({ 
      where: { shop: session.shop }, 
      update: { lastSyncedAt: new Date() }, 
      create: { shop: session.shop, lastSyncedAt: new Date() } 
    });
    return { status: "synced" };
  }

  if (intent === "create_po") {
    const itemsJson = formData.get("items");
    const items = JSON.parse(itemsJson);
    await createPurchaseOrders(session.shop, items);
    return { status: "po_created" };
  }

  if (intent === "pin") {
    const itemId = formData.get("itemId");
    const currentStatus = formData.get("currentStatus") === "true";
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { isPinned: !currentStatus } });
    return { status: "pinned" };
  }

  if (intent === "update_item") {
    const itemId = formData.get("itemId");
    const updates = {};
    if (formData.has("targetDays")) updates.targetDays = parseInt(formData.get("targetDays"));
    if (Object.keys(updates).length > 0) await prisma.inventoryItem.update({ where: { id: itemId }, data: updates });
    return { status: "updated" };
  }
  
  return null;
};

// --- BACKEND LOADER ---
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  const riskCritical = settings?.riskDaysCritical || 14;
  const riskWarning = settings?.riskDaysWarning || 30;

  const items = await prisma.inventoryItem.findMany({
    include: {
      sales: {
        where: { date: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) } } 
      }
    },
    orderBy: [
      { isPinned: 'desc' }, 
      { inventory: 'desc' } 
    ]
  });

  let totalStockValue = 0;
  let totalItems = items.length;
  let outOfStockCount = 0;
  let potentialRevenue = 0;
  let highRiskCount = 0;

  const enrichedItems = items.map(item => {
    totalStockValue += (item.inventory * item.cost);
    potentialRevenue += (item.inventory * item.price);
    if (item.inventory <= 0) outOfStockCount++;
    
    const totalSold = item.sales.reduce((acc, s) => acc + s.quantitySold, 0);
    const revenue30Days = item.sales.reduce((acc, s) => acc + (s.quantitySold * item.price), 0);
    const velocity = totalSold / 30; 
    
    let runway;
    if (item.inventory <= 0) {
      runway = -1;
    } else {
      runway = velocity > 0 ? item.inventory / velocity : 999;
    }

    const suggestedOrderQty = Math.max(0, Math.ceil((item.targetDays * velocity) - item.inventory));

    if (runway < riskCritical && item.inventory > 0) highRiskCount++;

    let statusLabel = "Healthy";
    if (item.inventory <= 0) statusLabel = "Out of Stock";
    else if (runway < riskCritical) statusLabel = "Critical";
    else if (runway < riskWarning) statusLabel = "Warning";
    
    if (runway > 180 && revenue30Days < 100) {
      statusLabel = "Dead Stock";
    }

    return {
      ...item,
      velocity,
      revenue30Days,
      runway,
      statusLabel,
      suggestedOrderQty, 
      vendor: item.vendor,
      sparkline: getSparklineData(item.sales)
    };
  });

  let aiReport = "AI Analysis Unavailable - Check API Key";
  
  if (settings?.openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: settings.openaiKey });
      const prompt = `
        Act as a Senior Inventory Manager. Analyze this store's status:
        - Total SKUs: ${totalItems}
        - Stockouts: ${outOfStockCount}
        - High Risk: ${highRiskCount}
        - Total Inventory Cost: $${totalStockValue.toFixed(2)}
        
        Provide a "Professional Management Summary" (max 3 sentences) focusing on capital efficiency and immediate risks.
      `;
      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-3.5-turbo",
      });
      aiReport = completion.choices[0].message.content;
    } catch (err) {
      aiReport = "Error generating AI report.";
    }
  }

  const shopHandle = session.shop.replace('.myshopify.com', '');

  return { 
    stats: { totalItems, outOfStockCount, totalStockValue, highRiskCount },
    items: enrichedItems,
    aiReport,
    shopHandle,
    settings: { 
      hasKey: !!settings?.openaiKey,
      lastSyncedAt: settings?.lastSyncedAt,
      riskCritical,
      riskWarning
    }
  };
};

// --- MAIN REACT COMPONENT ---
export default function ProfessionalAnalysis() {
  const { stats, items, aiReport, settings, shopHandle } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate(); 
  const navigation = useNavigation(); 
  const location = useLocation(); 

  const isSyncing = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "sync";
  const isLoading = navigation.state === "loading" && !isSyncing;

  // State
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState([]);
  const [queryValue, setQueryValue] = useState("");
  const [selectedStatus, setSelectedStatus] = useState([]);
  const [sortSelected, setSortSelected] = useState(["runway desc"]);

  // --- HANDLERS ---

  // 1. Initial Click: Prepare data for editing (as strings/numbers)
  const handleReviewClick = (itemsToReview) => {
    const cleanItems = itemsToReview.map(i => ({
        id: i.id,
        sku: i.sku,
        title: i.title,
        vendor: i.vendor,
        cost: i.cost || 0,
        quantity: i.suggestedOrderQty > 0 ? i.suggestedOrderQty : 0
    }));
    setReviewItems(cleanItems);
    setIsReviewOpen(true);
  };

  // 2. Handle Modal Edits (Updates Local State on Blur)
  const handleReviewItemChange = (index, field, value) => {
    setReviewItems(prev => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };
      return newItems;
    });
  };

  // 3. Confirm & Create: Converts text inputs back to valid numbers
  const handleConfirmCreate = () => {
    const formData = new FormData();
    formData.append("intent", "create_po");
    
    // Parse strings to numbers securely before sending
    const submissionItems = reviewItems.map(i => ({
        ...i,
        cost: parseFloat(i.cost) || 0,
        quantity: parseInt(i.quantity) || 0
    }));

    formData.append("items", JSON.stringify(submissionItems));
    fetcher.submit(formData, { method: "POST" });
    setIsReviewOpen(false);
  };

  // 4. Success Listener
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.status === "po_created") {
        if (window.shopify?.toast) {
            window.shopify.toast.show("Purchase Orders Created");
        }
        navigate("/app/purchase_orders" + location.search);
    }
  }, [fetcher.state, fetcher.data, navigate, location.search]);

  // Update item handler (for Target Days in main table)
  const handleUpdateItem = (id, field, value) => {
    const formData = new FormData();
    formData.append("intent", "update_item");
    formData.append("itemId", id);
    formData.append(field, value);
    fetcher.submit(formData, { method: "POST" });
  };

  // Filters & Sorting Logic
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
      1: 'price',
      2: 'cost',       
      3: 'targetDays', 
      4: 'inventory',
      6: 'velocity',
      7: 'runway',
      8: 'suggestedOrderQty'
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
    {label: 'Order Qty: High to Low', value: 'suggestedOrderQty desc'},
    {label: 'Inventory: High to Low', value: 'inventory desc'},
  ];

  const filteredItems = items.filter((item) => {
    const matchText = item.title.toLowerCase().includes(queryValue.toLowerCase()) || 
                      (item.sku && item.sku.toLowerCase().includes(queryValue.toLowerCase()));
    
    const matchStatus = selectedStatus.length === 0 || selectedStatus.includes(item.statusLabel);
    return matchText && matchStatus;
  });

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

  const resourceName = { singular: 'product', plural: 'products' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(sortedItems);

  // Bulk Actions
  const promotedBulkActions = [
    {
      content: 'Generate PO for Selected',
      onAction: () => {
        const selectedItems = sortedItems.filter(item => selectedResources.includes(item.id));
        handleReviewClick(selectedItems); 
      },
    },
  ];

  const filters = [
    {
      key: 'status',
      label: 'Status',
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: 'Out of Stock', value: 'Out of Stock' },
            { label: 'Critical Risk', value: 'Critical' },
            { label: 'Warning', value: 'Warning' },
            { label: 'Healthy', value: 'Healthy' },
            { label: 'Dead Stock (>180d, <$100)', value: 'Dead Stock' },
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

  const getStatusBadge = (item) => {
    if (item.statusLabel === "Out of Stock") return <Badge tone="critical">Out of Stock</Badge>;
    if (item.statusLabel === "Critical") return <Badge tone="critical">{Math.floor(item.runway)} Days</Badge>;
    if (item.statusLabel === "Warning") return <Badge tone="attention">{Math.floor(item.runway)} Days</Badge>;
    if (item.statusLabel === "Dead Stock") return <Badge tone="new">Dead Stock</Badge>;
    return <Badge tone="success">Healthy</Badge>;
  };

  // Row Markup
  const rowMarkup = sortedItems.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index} selected={selectedResources.includes(item.id)}>
      <IndexTable.Cell>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <Tooltip content={item.isPinned ? "Unpin product" : "Pin to top"}>
            <button 
              onClick={(e) => {
                e.stopPropagation(); 
                fetcher.submit({ intent: "pin", itemId: item.id, currentStatus: item.isPinned }, { method: "POST" });
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: item.isPinned ? '#008060' : '#babfc3', display: 'flex', alignItems: 'center' }}
            >
              <PinIcon width={20} />
            </button>
          </Tooltip>
          <BlockStack gap="050">
             <Text variant="bodyMd" fontWeight="bold">{item.title}</Text>
             <Text variant="bodySm" tone="subdued">SKU: {item.sku || 'N/A'}</Text>
             <Text variant="bodySm" tone="subdued">{item.vendor || 'Unknown Vendor'}</Text>
          </BlockStack>
        </div>
      </IndexTable.Cell>
      
      {/* Price Column */}
      <IndexTable.Cell><Text variant="bodyMd">${item.price?.toFixed(2) || '0.00'}</Text></IndexTable.Cell>

      {/* Cost Column */}
      <IndexTable.Cell><Text variant="bodyMd">${item.cost?.toFixed(2) || '0.00'}</Text></IndexTable.Cell>

      <IndexTable.Cell>
         {/* Target Days: Uses number input for DB update */}
         <EditableCell type="number" value={item.targetDays} onSave={(val) => handleUpdateItem(item.id, 'targetDays', val)} />
      </IndexTable.Cell>

      <IndexTable.Cell>{item.inventory}</IndexTable.Cell>
      
      <IndexTable.Cell>
        <div style={{ width: '100px', height: '30px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={item.sparkline}>
              <Line type="monotone" dataKey="val" stroke="#008060" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </IndexTable.Cell>

      <IndexTable.Cell><Text variant="bodyMd">{item.velocity.toFixed(1)} /day</Text></IndexTable.Cell>
      <IndexTable.Cell>{getStatusBadge(item)}</IndexTable.Cell>

      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" tone={item.suggestedOrderQty > 0 ? "critical" : "subdued"}>
          {item.suggestedOrderQty} units
        </Text>
      </IndexTable.Cell>

      <IndexTable.Cell>
        <ButtonGroup>
          <Tooltip content={`Generate PO for ${item.title}`}>
            <Button 
              icon={PageDownIcon} 
              variant="plain" 
              onClick={(e) => {
                e.stopPropagation();
                handleReviewClick([item]);
              }} 
            />
          </Tooltip>

          {item.statusLabel === "Dead Stock" && (
             <Tooltip content="Create Liquidation Discount">
               <Button 
                 icon={DiscountIcon} 
                 variant="plain" 
                 tone="critical"
                 url={`https://admin.shopify.com/store/${shopHandle}/discounts/new`}
                 target="_blank"
               />
             </Tooltip>
          )}
        </ButtonGroup>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const lastSynced = settings.lastSyncedAt ? new Date(settings.lastSyncedAt).toLocaleString() : "Never";

  // Loading State
  if (isLoading) {
    return <Page fullWidth><div style={{height:'60vh', display:'flex', justifyContent:'center', alignItems:'center'}}><Spinner size="large" /></div></Page>;
  }

  // Key Warning State
  if (!settings.hasKey) {
    return (
      <Page title="Inventory Report">
        <Banner tone="warning" title="Setup Required">Please add your OpenAI API Key in Settings.</Banner>
      </Page>
    );
  }

  // --- FINAL RENDER ---
  return (
    <Page 
      title="Strategic Inventory Report" 
      fullWidth
      primaryAction={{
        content: isSyncing ? 'Syncing...' : 'Sync Data',
        icon: RefreshIcon,
        onAction: () => fetcher.submit({ intent: "sync" }, { method: "POST" }),
        loading: isSyncing,
      }}
      secondaryActions={[
        {
          content: "Dashboard",
          url: "/app" + location.search,
        },
        {
          content: "Inventory Analysis",
          url: "/app/analyze" + location.search,
        },
        {
          content: "Supplier Management",
          url: "/app/suppliers" + location.search,
        },
        {
          content: "Purchase Orders",
          url: "/app/purchase_orders" + location.search,
        },
        {
          content: "Settings",
          icon: SettingsIcon,
          url: "/app/settings" + location.search,
        },
      ]}
    >
      <BlockStack gap="500">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 1rem' }}>
           <Text variant="bodySm" tone="subdued">
             Risk Thresholds: &lt;{settings.riskCritical} days (Critical), &lt;{settings.riskWarning} days (Warning)
           </Text>
           <Text variant="bodySm" tone={isSyncing ? "success" : "subdued"}>
             {isSyncing ? "↻ Syncing live data..." : `✓ Last Synced: ${lastSynced}`}
           </Text>
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg" as="h2">Executive Summary</Text>
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <Text variant="bodyLg" as="p">{aiReport}</Text>
                </Box>
                <Divider />
                <InlineGrid columns={4} gap="400">
                  <Box><Text variant="headingXs" tone="subdued">TOTAL VALUATION</Text><Text variant="headingLg">${stats.totalStockValue.toLocaleString()}</Text></Box>
                  <Box><Text variant="headingXs" tone="subdued">STOCKOUTS</Text><Text variant="headingLg" tone={stats.outOfStockCount > 0 ? "critical" : "success"}>{stats.outOfStockCount}</Text></Box>
                  <Box><Text variant="headingXs" tone="subdued">HIGH RISK ITEMS</Text><Text variant="headingLg" tone={stats.highRiskCount > 5 ? "critical" : "attention"}>{stats.highRiskCount}</Text></Box>
                  <Box><Text variant="headingXs" tone="subdued">ACTIVE SKUS</Text><Text variant="headingLg">{stats.totalItems}</Text></Box>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px' }}>
                <div style={{ flex: 1 }}>
                  <Filters
                    queryValue={queryValue}
                    filters={filters}
                    appliedFilters={appliedFilters}
                    onQueryChange={handleQueryValueChange}
                    onQueryClear={handleQueryValueRemove}
                    onClearAll={handleFiltersClearAll}
                  />
                </div>
                <div style={{ width: '200px' }}>
                   <Select label="Sort by" labelInline options={sortOptions} onChange={handleSortChange} value={sortSelected[0]} />
                </div>
              </div>
              
              <IndexTable
                resourceName={resourceName}
                itemCount={sortedItems.length}
                selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                sortable={[true, true, true, false, true, true, true, true, true]} 
                sortSelected={sortSelected}
                onSort={onSort}
                headings={[
                  { title: 'Product' },
                  { title: 'Price' }, // NEW Header
                  { title: 'Cost' },       
                  { title: 'Target Days' },
                  { title: 'Stock' },
                  { title: 'Trend' }, 
                  { title: 'Velocity' },
                  { title: 'Status' },
                  { title: 'Suggested Order' },
                  { title: 'Actions' }
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* --- REVIEW PURCHASE ORDER MODAL --- */}
      {isReviewOpen && (
        <Modal
          open={true}
          onClose={() => setIsReviewOpen(false)}
          title="Review Purchase Orders"
          primaryAction={{
            content: 'Create POs',
            onAction: handleConfirmCreate,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setIsReviewOpen(false),
            },
          ]}
          large
        >
          <Modal.Section>
            <Text as="p" variant="bodyMd" tone="subdued">
               Review quantities and costs before generating internal Purchase Orders.
            </Text>
            <Box paddingBlockStart="400">
            <IndexTable
               resourceName={{ singular: 'item', plural: 'items' }}
               itemCount={reviewItems.length}
               headings={[
                 { title: 'Vendor' },
                 { title: 'Product' },
                 { title: 'Cost' },
                 { title: 'Order Qty' }
               ]}
               selectable={false}
            >
              {reviewItems.map((item, index) => (
                <IndexTable.Row key={index} id={item.id} position={index}>
                  <IndexTable.Cell>{item.vendor}</IndexTable.Cell>
                  <IndexTable.Cell>{item.title}</IndexTable.Cell>
                  
                  {/* EDITABLE COST: using EditableCell with text type for stability */}
                  <IndexTable.Cell>
                      <EditableCell 
                        value={item.cost} 
                        prefix="$" 
                        onSave={(val) => handleReviewItemChange(index, 'cost', val)}
                      />
                  </IndexTable.Cell>

                  {/* EDITABLE QUANTITY */}
                  <IndexTable.Cell>
                      <EditableCell 
                        value={item.quantity} 
                        onSave={(val) => handleReviewItemChange(index, 'quantity', val)}
                      />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
            </Box>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}