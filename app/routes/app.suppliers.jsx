// app/routes/app.suppliers.jsx
import { useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSuppliers } from "../services/inventory.server"; // Make sure this function exists
import {
  Page, Layout, Card, IndexTable, Text, Button, Banner
} from "@shopify/polaris";
import { PlusIcon, SettingsIcon, ImportIcon } from "@shopify/polaris-icons"; 

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const suppliers = await prisma.supplier.findMany({
    include: { _count: { select: { items: true } } }
  });
  return { suppliers };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  if (intent === "create") {
    const uniqueSuffix = Math.floor(Math.random() * 10000);
    const name = `New Supplier ${uniqueSuffix}`;
    const supplier = await prisma.supplier.create({
      data: { shop: session.shop, name: name, leadTime: 14 }
    });
    return { status: "created", id: supplier.id };
  }

  // --- NEW: Import Vendors from Shopify ---
  if (intent === "import_shopify") {
    // Ensure you have added the syncSuppliers function to app/services/inventory.server.js
    const count = await syncSuppliers(admin, session.shop);
    return { status: "imported", count };
  }

  return null;
};

export default function Suppliers() {
  const { suppliers } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const handleCreate = () => {
    fetcher.submit({ intent: "create" }, { method: "POST" });
  };

  const handleImport = () => {
    fetcher.submit({ intent: "import_shopify" }, { method: "POST" });
  };
  
  useEffect(() => {
    if (fetcher.data?.status === "created") {
      navigate(`/app/supplier/${fetcher.data.id}` + window.location.search);
    }
    if (fetcher.data?.status === "imported") {
      window.shopify.toast.show(`Imported ${fetcher.data.count} vendors`);
    }
  }, [fetcher.data, navigate]);

  const rowMarkup = suppliers.map((supplier, index) => (
    <IndexTable.Row 
      id={supplier.id} 
      key={supplier.id} 
      position={index}
      onClick={() => navigate(`/app/supplier/${supplier.id}` + window.location.search)} 
    >
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">{supplier.name}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{supplier.email || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{supplier.contactName || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{supplier.leadTime} Days</IndexTable.Cell>
      <IndexTable.Cell>{supplier._count.items} SKUs</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Supplier Database"
      primaryAction={
        <Button variant="primary" icon={PlusIcon} onClick={handleCreate} loading={fetcher.state === "submitting"}>
          Add Supplier
        </Button>
      }
      secondaryActions={[
        // --- NEW BUTTON ---
        {
          content: "Import from Shopify",
          icon: ImportIcon,
          onAction: handleImport,
          loading: fetcher.state === "submitting" && fetcher.formData?.get("intent") === "import_shopify"
        },
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
      <Layout>
        <Layout.Section>
          {suppliers.length === 0 && (
             <Banner title="Get Started" tone="info">
               <p>Click "Import from Shopify" to automatically load your existing vendors.</p>
             </Banner>
           )}
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: 'supplier', plural: 'suppliers' }}
              itemCount={suppliers.length}
              headings={[
                { title: 'Name' },
                { title: 'Email' },
                { title: 'Contact' },
                { title: 'Lead Time' },
                { title: 'Linked Products' },
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