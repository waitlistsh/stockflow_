// app/routes/app.supplier.$id.jsx
import { useState, useEffect } from "react";
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
  
if (params.id === "new") {
    return {
      supplier: {
        name: "",
        items: [],
        leadTime: 14,
        paymentTerms: "Net 30",
        vatRate: 0 // Default
      },
      unassignedItems: []
    };
  }





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
    const data = {
        name: formData.get("name"),
        email: formData.get("email"),
        contactName: formData.get("contactName"),
        leadTime: parseInt(formData.get("leadTime") || "14"),
        address: formData.get("address"),
        paymentTerms: formData.get("paymentTerms"),
        vatRate: parseFloat(formData.get("vatRate") || "0"),
        shop: session.shop // Ensure shop is set
    };

    // --- CREATE IF NEW ---
    if (params.id === "new") {
       const newSupplier = await prisma.supplier.create({ data });
       return redirect(`/app/supplier/${newSupplier.id}`); // Redirect to real ID
    }
    // ---------------------

    await prisma.supplier.update({
      where: { id: params.id },
      data
    });
    return { status: "updated" };
  }
   

  if (intent === "link_product") {
    const itemId = formData.get("itemId");
    
    // --- NEW: Fetch Supplier to get Default VAT ---
    const supplier = await prisma.supplier.findUnique({ where: { id: params.id }});
    
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { 
          supplierId: params.id,
          vatRate: supplier.vatRate // --- Inherit VAT on Link ---
      }
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

  // --- Handle Cost Update ---
  if (intent === "update_item_cost") {
    const itemId = formData.get("itemId");
    const cost = parseFloat(formData.get("cost") || "0");
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { cost }
    });
    return { status: "cost_updated" };
  }

  // --- NEW: Handle VAT Update ---
  if (intent === "update_item_vat") {
    const itemId = formData.get("itemId");
    const vatRate = parseFloat(formData.get("vatRate") || "0");
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { vatRate }
    });
    return { status: "vat_updated" };
  }

  return null;
};

// Generic Editable Cell Component
function EditableCell({ id, value, fieldName, onSave, prefix = "", suffix = "" }) {
  const [currentValue, setCurrentValue] = useState(value);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  const handleBlur = () => {
    if (parseFloat(currentValue) !== value) {
      onSave(id, currentValue);
    }
  };

  return (
    <div style={{ maxWidth: '100px' }}>
      <TextField 
        type="number" 
        value={String(currentValue)} 
        onChange={(val) => setCurrentValue(val)} 
        onBlur={handleBlur} 
        prefix={prefix}
        suffix={suffix}
        autoComplete="off"
        label={fieldName}
        labelHidden
      />
    </div>
  );
}

export default function SupplierDetail() {
  const { supplier, unassignedItems } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  
  const [formState, setFormState] = useState({
    name: supplier.name,
    email: supplier.email || "",
    contactName: supplier.contactName || "",
    leadTime: supplier.leadTime,
    address: supplier.address || "",
    paymentTerms: supplier.paymentTerms || "Net 30",
    vatRate: supplier.vatRate || 0 // --- NEW STATE
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

  const handleUpdateCost = (itemId, newCost) => {
    fetcher.submit(
        { intent: "update_item_cost", itemId, cost: newCost },
        { method: "POST" }
    );
  };

  // --- NEW VAT HANDLER ---
  const handleUpdateVat = (itemId, newVat) => {
    fetcher.submit(
        { intent: "update_item_vat", itemId, vatRate: newVat },
        { method: "POST" }
    );
  };

  const rowMarkup = supplier.items.map((item, index) => (
    <IndexTable.Row id={item.id} key={item.id} position={index}>
      <IndexTable.Cell><Text fontWeight="bold">{item.title}</Text></IndexTable.Cell>
      <IndexTable.Cell>{item.sku}</IndexTable.Cell>
      
      {/* Cost Column */}
      <IndexTable.Cell>
         <EditableCell 
            id={item.id} 
            value={item.cost} 
            fieldName="cost"
            onSave={handleUpdateCost} 
            prefix="$"
         />
      </IndexTable.Cell>

      {/* --- NEW VAT COLUMN --- */}
      <IndexTable.Cell>
         <EditableCell 
            id={item.id} 
            value={item.vatRate} 
            fieldName="vatRate"
            onSave={handleUpdateVat} 
            suffix="%"
         />
      </IndexTable.Cell>
      
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
                <Select
                  label="Payment Terms"
                  options={paymentOptions}
                  onChange={(val) => setFormState({...formState, paymentTerms: val})}
                  value={formState.paymentTerms}
                />
              </InlineGrid>

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
                 />
                 {/* --- NEW MASTER VAT FIELD --- */}
                 <TextField 
                   label="Default VAT Rate (%)" 
                   type="number" 
                   value={String(formState.vatRate)} 
                   onChange={(val) => setFormState({...formState, vatRate: val})} 
                   autoComplete="off" 
                   suffix="%"
                   helpText="This rate will be applied to newly linked products."
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
              headings={[
                  { title: 'Product' }, 
                  { title: 'SKU' }, 
                  { title: 'Cost' }, 
                  { title: 'VAT' }, // --- NEW HEADER
                  { title: 'Stock' }, 
                  { title: 'Action' }
              ]}
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