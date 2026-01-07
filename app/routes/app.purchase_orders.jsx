// app/routes/app.purchase_orders.jsx
import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generatePO } from "../utils/pdfGenerator";
import { updatePurchaseOrder, receivePurchaseOrder } from "../services/po.server"; 
import {
  Page, Layout, Card, IndexTable, Text, Badge, Button, Modal, 
  useIndexResourceState, TextField, InlineStack, Tooltip, Banner
} from "@shopify/polaris";
import { PageDownIcon, EditIcon, DeleteIcon, ImportIcon } from "@shopify/polaris-icons"; 

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

  if (intent === "receive") {
    // Call service and capture result
    const result = await receivePurchaseOrder(admin, session.shop, id);
    
    // If service returns an error object, send it to frontend
    if (result.error) {
        return { status: "error", message: result.error };
    }
    return { status: "received", count: result.count };
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

  // --- ERROR & SUCCESS HANDLING ---
  useEffect(() => {
    if (fetcher.data?.status === "received") {
        window.shopify.toast.show(`Success! Stock added for ${fetcher.data.count} items.`);
        setErrorMessage(null);
    }
    if (fetcher.data?.status === "updated") {
        window.shopify.toast.show("PO updated successfully");
    }
    if (fetcher.data?.status === "error") {
        // If the error mentions 'scope' or permissions, force a reload to trigger auth
        if (fetcher.data.message && fetcher.data.message.includes("scope")) {
            window.top.location.reload(); // <--- FORCE RELOAD TO AUTH
        } else {
            setErrorMessage(fetcher.data.message);
            window.shopify.toast.show("Failed to receive PO", { isError: true });
        }
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
    newItems[index][field] = value; 
    setEditItems(newItems);
  };

  const handleSaveChanges = () => {
    if (!activePo) return;
    
    const cleanItems = editItems.map(item => ({
        ...item,
        cost: parseFloat(item.cost) || 0,
        quantity: parseInt(item.quantity) || 0,
        vatRate: parseFloat(item.vatRate) || 0
    }));

    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("id", activePo.id);
    formData.append("items", JSON.stringify(cleanItems));
    
    fetcher.submit(formData, { method: "POST" });
    handleCloseModal();
  };

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

  const rowMarkup = pos.map((po, index) => {
    const net = po.totalCost;
    const tax = po.totalTax || 0;
    const grandTotal = net + tax;

    return (
      <IndexTable.Row id={po.id} key={po.id} position={index} selected={selectedResources.includes(po.id)}>
        <IndexTable.Cell><Text fontWeight="bold">#{po.poNumber}</Text></IndexTable.Cell>
        <IndexTable.Cell>{new Date(po.createdAt).toLocaleDateString()}</IndexTable.Cell>
        <IndexTable.Cell>{po.vendor}</IndexTable.Cell>
        <IndexTable.Cell>{po.items.length} Items</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span">${grandTotal.toFixed(2)}</Text>
          <Text as="span" variant="bodySm" tone="subdued" breakWord>
             (Tax: ${tax.toFixed(2)})
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell><Badge tone={po.status === "OPEN" ? "info" : "success"}>{po.status}</Badge></IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200">
             {po.status === "OPEN" && (
               <Tooltip content="Mark Received & Add Stock">
                  {/* Loading state helps user know something is happening */}
                  <Button 
                    icon={ImportIcon} 
                    onClick={() => handleReceive(po)} 
                    loading={fetcher.state === "submitting" && fetcher.formData?.get("id") === po.id}
                    accessibilityLabel="Receive Items" 
                  />
               </Tooltip>
             )}
             <Button icon={PageDownIcon} onClick={() => handleDownloadPDF(po)} accessibilityLabel="Download PDF" />
             <Button icon={EditIcon} onClick={() => handleEditClick(po)} accessibilityLabel="Edit PO" />
             <Button icon={DeleteIcon} tone="critical" onClick={() => fetcher.submit({intent: "delete", id: po.id}, {method: "POST"})} />
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page 
      title="Purchase Orders" 
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
    >
      <Layout>
        <Layout.Section>
          
          {/* --- ERROR BANNER: This will tell you EXACTLY why it failed --- */}
          {fetcher.data?.status === "error" && (
            <Banner tone="critical" title="Error Receiving PO">
              <p>{fetcher.data.message}</p>
              <p>Try restarting your server: <code>npm run dev</code></p>
            </Banner>
          )}

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

      {activePo && (
        <Modal
          open={true}
          onClose={handleCloseModal}
          title={`Edit PO #${activePo.poNumber} - ${activePo.vendor}`}
          primaryAction={{
            content: 'Save Changes',
            onAction: handleSaveChanges,
          }}
          secondaryActions={[{ content: 'Cancel', onAction: handleCloseModal }]}
          size="large"
        >
          <Modal.Section>
             <IndexTable
                resourceName={{ singular: 'item', plural: 'items' }}
                itemCount={editItems.length}
                headings={[
                    { title: 'SKU' }, 
                    { title: 'Product' }, 
                    { title: 'Cost' }, 
                    { title: 'VAT %' }, 
                    { title: 'Qty' }
                ]}
                selectable={false}
             >
                {editItems.map((item, idx) => (
                    <IndexTable.Row key={idx} id={idx} position={idx}>
                        <IndexTable.Cell>{item.sku}</IndexTable.Cell>
                        <IndexTable.Cell>{item.title}</IndexTable.Cell>
                        <IndexTable.Cell>
                            <div style={{ maxWidth: '100px' }}>
                                <TextField 
                                    type="number" 
                                    value={String(item.cost)} 
                                    onChange={(val) => handleUpdateItem(idx, 'cost', val)} 
                                    prefix="$"
                                    autoComplete="off"
                                />
                            </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <div style={{ maxWidth: '100px' }}>
                                <TextField 
                                    type="number" 
                                    value={String(item.vatRate || 0)} 
                                    onChange={(val) => handleUpdateItem(idx, 'vatRate', val)} 
                                    suffix="%"
                                    autoComplete="off"
                                />
                            </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <div style={{ maxWidth: '100px' }}>
                                <TextField 
                                    type="number" 
                                    value={String(item.quantity)} 
                                    onChange={(val) => handleUpdateItem(idx, 'quantity', val)} 
                                    autoComplete="off"
                                />
                            </div>
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