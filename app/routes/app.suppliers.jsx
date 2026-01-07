// app/routes/app.suppliers.jsx
import { useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher, useLocation, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncSuppliers } from "../services/inventory.server"; 
import {
  Page, Layout, Card, IndexTable, Button, Banner, Text, Tooltip
} from "@shopify/polaris";
import { PlusIcon, SettingsIcon, ImportIcon, EditIcon } from "@shopify/polaris-icons"; 

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

  if (intent === "import_shopify") {
    const count = await syncSuppliers(admin, session.shop);
    return { status: "imported", count };
  }

  return null;
};

export default function Suppliers() {
  const { suppliers } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const location = useLocation(); 

  const handleCreate = () => {
    fetcher.submit({ intent: "create" }, { method: "POST" });
  };

  const handleImport = () => {
    fetcher.submit({ intent: "import_shopify" }, { method: "POST" });
  };
  
  useEffect(() => {
    if (fetcher.data?.status === "created") {
      navigate(`/app/supplier/${fetcher.data.id}${location.search}`);
    }
    if (fetcher.data?.status === "imported" && window.shopify?.toast) {
      window.shopify.toast.show(`Imported ${fetcher.data.count} vendors`);
    }
  }, [fetcher.data, navigate, location.search]);

  // Reliable navigation helper
  const goToSupplier = (id) => {
    const target = `/app/supplier/${id}${location.search}`;
    navigate(target);
  };

  const rowMarkup = suppliers.map((supplier, index) => (
    <IndexTable.Row 
      id={supplier.id} 
      key={supplier.id} 
      position={index}
      // Primary row click handler
      onClick={() => goToSupplier(supplier.id)}
    >
      <IndexTable.Cell>
        {/* Explicit Link - stops propagation so it doesn't conflict with row click */}
        <div onClick={(e) => e.stopPropagation()}>
          <Link 
            to={`/app/supplier/${supplier.id}${location.search}`}
            style={{ fontWeight: 'bold', textDecoration: 'none', color: '#202223' }}
          >
            <Text fontWeight="bold" as="span">{supplier.name}</Text>
          </Link>
        </div>
      </IndexTable.Cell>
      
      <IndexTable.Cell>{supplier.email || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{supplier.contactName || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{supplier.leadTime} Days</IndexTable.Cell>
      <IndexTable.Cell>{supplier._count.items} SKUs</IndexTable.Cell>

      {/* Explicit Action Column */}
      <IndexTable.Cell>
         <div onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Edit Supplier Details">
                <Button 
                    icon={EditIcon} 
                    variant="plain" 
                    onClick={() => goToSupplier(supplier.id)}
                    accessibilityLabel="Edit"
                />
            </Tooltip>
         </div>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Supplier Database"
      primaryAction={
        <Button 
          variant="primary" 
          icon={PlusIcon} 
          onClick={handleCreate} 
          loading={fetcher.state === "submitting" && fetcher.formData?.get("intent") === "create"}
        >
          Add Supplier
        </Button>
      }
      secondaryActions={[
        {
          content: "Import from Shopify",
          icon: ImportIcon,
          onAction: handleImport,
          loading: fetcher.state === "submitting" && fetcher.formData?.get("intent") === "import_shopify"
        },
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
                { title: '' } // Action Column
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