// app/routes/app.purchase_orders.jsx
import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generatePO } from "../utils/pdfGenerator";
import { updatePurchaseOrder, receivePurchaseOrder } from "../services/po.server"; // Import receive function
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button, Modal, 
  useIndexResourceState, TextField, BlockStack, InlineStack, Tooltip
} from "@shopify/polaris";
import { PageDownIcon, EditIcon, DeleteIcon, ImportIcon } from "@shopify/polaris-icons"; // Added ImportIcon

// --- LOADER ---
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const pos = await prisma.purchaseOrder.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return { pos, shopHandle: session.shop.replace(".myshopify.com", "") };
};

// --- ACTION ---
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");

  if (intent === "delete") {
    await prisma.purchaseOrder.delete({ where: { id } });
    return { status: "deleted" };
  }

  if (intent === "update") {
    const items = JSON.parse(formData.get("items"));
    await updatePurchaseOrder(id, items);
    return { status: "updated" };
  }

  // --- NEW: Receive Action ---
  if (intent === "receive") {
    // You need to ensure receivePurchaseOrder is exported from app/services/po.server.js
    await receivePurchaseOrder(admin, session.shop, id);
    return { status: "received" };
  }

  return null;
};

// --- MAIN COMPONENT ---
export default function PurchaseOrders() {
  const { pos, shopHandle } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  // Modal State
  const [activePo, setActivePo] = useState(null); 
  const [editItems, setEditItems] = useState([]); 

  useEffect(() => {
    if (fetcher.data?.status === "received") {
        window.shopify.toast.show("Inventory updated successfully");
    }
  }, [fetcher.data]);

  const handleEditClick = (po) => {
    setActivePo(po);
    setEditItems(JSON.parse(JSON.stringify(po.items)));
  };

  const handleCloseModal = () => {
    setActivePo(null);
    setEditItems([]);
  };

  const handleUpdateItem = (index, field, value) => {
    const newItems = [...editItems];
    newItems[index][field] = field === "quantity" ? parseInt(value) : parseFloat(value);
    setEditItems(newItems);
  };

  const handleSaveChanges = () => {
    if (!activePo) return;
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("id", activePo.id);
    formData.append("items", JSON.stringify(editItems));
    fetcher.submit(formData, { method: "POST" });
    handleCloseModal();
  };

  // --- NEW: Handle Receive ---
  const handleReceive = (po) => {
    if (confirm(`Receive PO #${po.poNumber}? This will add stock to your inventory.`)) {
        fetcher.submit({ intent: "receive", id: po.id }, { method: "POST" });
    }
  };

  const handleDownloadPDF = (po) => {
    const itemsForPdf = po.items.map(i => ({
      ...i,
      vendor: po.vendor 
    }));
    
    generatePO(itemsForPdf, { shopHandle }, {
      poNumberOverride: po.poNumber,
      dateOverride: po.createdAt
    });
  };

  const resourceName = { singular: 'purchase order', plural: 'purchase orders' };
  const { selectedResources, allResourcesSelected, handleSelectionChange } = useIndexResourceState(pos);

  const rowMarkup = pos.map((po, index) => (
    <IndexTable.Row id={po.id} key={po.id} position={index} selected={selectedResources.includes(po.id)}>
      <IndexTable.Cell><Text fontWeight="bold">#{po.poNumber}</Text></IndexTable.Cell>
      <IndexTable.Cell>{new Date(po.createdAt).toLocaleDateString()}</IndexTable.Cell>
      <IndexTable.Cell>{po.vendor}</IndexTable.Cell>
      <IndexTable.Cell>{po.items.length} Items</IndexTable.Cell>
      <IndexTable.Cell>${po.totalCost.toFixed(2)}</IndexTable.Cell>
      <IndexTable.Cell><Badge tone={po.status === "OPEN" ? "info" : "success"}>{po.status}</Badge></IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
           {/* --- NEW: Receive Button --- */}
           {po.status === "OPEN" && (
             <Tooltip content="Mark Received & Add Stock">
                <Button icon={ImportIcon} onClick={() => handleReceive(po)} accessibilityLabel="Receive Items" />
             </Tooltip>
           )}
           <Button icon={PageDownIcon} onClick={() => handleDownloadPDF(po)} accessibilityLabel="Download PDF" />
           <Button icon={EditIcon} onClick={() => handleEditClick(po)} accessibilityLabel="Edit PO" />
           <Button icon={DeleteIcon} tone="critical" onClick={() => fetcher.submit({intent: "delete", id: po.id}, {method: "POST"})} />
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Purchase Orders" 
      backAction={{ content: "Dashboard", onAction: () => navigate("/app/suppliers" + window.location.search) }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={pos.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'PO #' },
                { title: 'Date' },
                { title: 'Vendor' },
                { title: 'Items' },
                { title: 'Total Cost' },
                { title: 'Status' },
                { title: 'Actions' }
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      {/* --- EDIT MODAL (Unchanged) --- */}
      {activePo && (
        <Modal
          open={true}
          onClose={handleCloseModal}
          title={`Edit PO #${activePo.poNumber} - ${activePo.vendor}`}
          primaryAction={{
            content: 'Save Changes',
            onAction: handleSaveChanges,
          }}
          secondaryActions={[
            {
              content: "Dashboard",
              url: "/app" + location.search, // Use 'url' instead of 'onAction'
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
          large
        >
          <Modal.Section>
             <IndexTable
                resourceName={{ singular: 'item', plural: 'items' }}
                itemCount={editItems.length}
                headings={[{ title: 'SKU' }, { title: 'Product' }, { title: 'Cost' }, { title: 'Qty' }]}
                selectable={false}
             >
                {editItems.map((item, idx) => (
                    <IndexTable.Row key={idx} id={idx} position={idx}>
                        <IndexTable.Cell>{item.sku}</IndexTable.Cell>
                        <IndexTable.Cell>{item.title}</IndexTable.Cell>
                        <IndexTable.Cell>
                            <TextField 
                                type="number" 
                                value={String(item.cost)} 
                                onChange={(val) => handleUpdateItem(idx, 'cost', val)} 
                                prefix="$"
                            />
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <TextField 
                                type="number" 
                                value={String(item.quantity)} 
                                onChange={(val) => handleUpdateItem(idx, 'quantity', val)} 
                            />
                        </IndexTable.Cell>
                    </IndexTable.Row>
                ))}
             </IndexTable>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}