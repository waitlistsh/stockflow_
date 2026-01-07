// app/routes/app.suppliers.jsx
import { useEffect } from "react"; // Import useEffect
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  Page, Layout, Card, IndexTable, Text, Button
} from "@shopify/polaris";
import { PlusIcon, SettingsIcon } from "@shopify/polaris-icons"; 

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const suppliers = await prisma.supplier.findMany({
    include: { _count: { select: { items: true } } }
  });
  return { suppliers };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  if (formData.get("intent") === "create") {
    // Generate unique name to prevent duplicates
    const uniqueSuffix = Math.floor(Math.random() * 10000);
    const name = `New Supplier ${uniqueSuffix}`;
    
    const supplier = await prisma.supplier.create({
      data: {
        shop: session.shop,
        name: name,
        leadTime: 14
      }
    });
    return { status: "created", id: supplier.id };
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
  
  // --- FIX: Wrap navigation in useEffect to prevent blank page crash ---
  useEffect(() => {
    if (fetcher.data?.status === "created") {
      navigate(`/app/supplier/${fetcher.data.id}` + window.location.search);
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