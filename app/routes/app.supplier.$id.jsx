// app/routes/app.supplier.$id.jsx
import { useState } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  Page, Layout, Card, Text, TextField, BlockStack, InlineGrid, 
  IndexTable, Button, InlineStack, Box, Divider, Select
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";


export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  
  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    include: { items: true }
  });

  const unassignedItems = await prisma.inventoryItem.findMany({
    where: { supplierId: null },
    take: 50 
  });

  if (!supplier) throw new Response("Not Found", { status: 404 });

  return { supplier, unassignedItems };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update_details") {
    await prisma.supplier.update({
      where: { id: params.id },
      data: {
        name: formData.get("name"),
        email: formData.get("email"),
        contactName: formData.get("contactName"),
        leadTime: parseInt(formData.get("leadTime") || "14"),
        // --- SAVE NEW FIELDS ---
        address: formData.get("address"),
        paymentTerms: formData.get("paymentTerms"),
      }
    });
    return { status: "updated" };
  }

  if (intent === "link_product") {
    const itemId = formData.get("itemId");
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { supplierId: params.id }
    });
    return { status: "linked" };
  }

  if (intent === "unlink_product") {
    const itemId = formData.get("itemId");
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { supplierId: null }
    });
    return { status: "unlinked" };
  }

  return null;
};

export default function SupplierDetail() {
  const { supplier, unassignedItems } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  
  // --- ADDED NEW FIELDS TO STATE ---
  const [formState, setFormState] = useState({
    name: supplier.name,
    email: supplier.email || "",
    contactName: supplier.contactName || "",
    leadTime: supplier.leadTime,
    address: supplier.address || "",
    paymentTerms: supplier.paymentTerms || "Net 30"
  });

  const handleSave = () => {
    fetcher.submit(
      { intent: "update_details", ...formState }, 
      { method: "POST" }
    );
  };

  const handleLink = (itemId) => {
    fetcher.submit({ intent: "link_product", itemId }, { method: "POST" });
  };

  const handleUnlink = (itemId) => {
    fetcher.submit({ intent: "unlink_product", itemId }, { method: "POST" });
  };

  const rowMarkup = supplier.items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index}>
      <IndexTable.Cell><Text fontWeight="bold">{item.title}</Text></IndexTable.Cell>
      <IndexTable.Cell>{item.sku}</IndexTable.Cell>
      <IndexTable.Cell>{item.inventory}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button 
          size="micro" 
          tone="critical" 
          variant="plain" 
          icon={DeleteIcon} 
          onClick={() => handleUnlink(item.id)}
        >
          Unlink
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const paymentOptions = [
    {label: 'Net 30', value: 'Net 30'},
    {label: 'Net 60', value: 'Net 60'},
    {label: 'Due on Receipt', value: 'Due on Receipt'},
    {label: 'Prepaid', value: 'Prepaid'},
  ];

  return (
    <Page
      title={supplier.name}
      backAction={{ 
        content: "Supplier Database", 
        onAction: () => navigate("/app/suppliers" + window.location.search) 
      }}
      primaryAction={{ content: "Save Changes", onAction: handleSave, loading: fetcher.state === "submitting" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd">Supplier Details</Text>
              
              <InlineGrid columns={2} gap="400">
                <TextField 
                  label="Company Name" 
                  value={formState.name} 
                  onChange={(val) => setFormState({...formState, name: val})} 
                  autoComplete="off" 
                />
                <TextField 
                  label="Contact Person" 
                  value={formState.contactName} 
                  onChange={(val) => setFormState({...formState, contactName: val})} 
                  autoComplete="off" 
                />
                <TextField 
                  label="Email Address" 
                  type="email" 
                  value={formState.email} 
                  onChange={(val) => setFormState({...formState, email: val})} 
                  autoComplete="off" 
                />
                 {/* --- NEW: Payment Terms Select --- */}
                <Select
                  label="Payment Terms"
                  options={paymentOptions}
                  onChange={(val) => setFormState({...formState, paymentTerms: val})}
                  value={formState.paymentTerms}
                />
              </InlineGrid>

               {/* --- NEW: Address Field (Full Width) --- */}
              <TextField 
                label="Full Address (Street, City, Zip, Country)" 
                value={formState.address} 
                onChange={(val) => setFormState({...formState, address: val})} 
                multiline={3} 
                autoComplete="off" 
              />
              
              <InlineGrid columns={2} gap="400">
                 <TextField 
                   label="Lead Time (Days)" 
                   type="number" 
                   value={String(formState.leadTime)} 
                   onChange={(val) => setFormState({...formState, leadTime: val})} 
                   autoComplete="off" 
                   helpText="Average time from order to delivery."
                 />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd">Linked Products ({supplier.items.length})</Text>
                
                {unassignedItems.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select 
                      style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', maxWidth: '200px' }}
                      onChange={(e) => {
                        if (e.target.value) handleLink(e.target.value);
                        e.target.value = ""; 
                      }}
                    >
                      <option value="">+ Assign Product...</option>
                      {unassignedItems.map(i => (
                        <option key={i.id} value={i.id}>{i.title}</option>
                      ))}
                    </select>
                  </div>
                )}
              </InlineStack>
            </Box>
            
            <Divider />

            <IndexTable
              resourceName={{ singular: 'product', plural: 'products' }}
              itemCount={supplier.items.length}
              headings={[{ title: 'Product' }, { title: 'SKU' }, { title: 'Stock' }, { title: 'Action' }]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}