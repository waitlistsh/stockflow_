// app/routes/app.settings.jsx
import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation, useNavigate } from "react-router"; 
import { 
  Page, Layout, Card, FormLayout, TextField, Button, BlockStack, Text, Banner, Box, Checkbox, Divider
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const openaiKey = formData.get("openaiKey");
  const riskDaysCritical = parseInt(formData.get("riskDaysCritical") || "14");
  const riskDaysWarning = parseInt(formData.get("riskDaysWarning") || "30");
  
  // Handle PO Settings
  const lastPoNumber = parseInt(formData.get("lastPoNumber") || "1000");
  const syncDraftOrders = formData.get("syncDraftOrders") === "on";

  await prisma.merchantSettings.upsert({
    where: { shop: session.shop },
    update: { openaiKey, riskDaysCritical, riskDaysWarning, lastPoNumber, syncDraftOrders },
    create: { shop: session.shop, openaiKey, riskDaysCritical, riskDaysWarning, lastPoNumber, syncDraftOrders }
  });

  return { status: "saved" };
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.merchantSettings.findUnique({ where: { shop: session.shop } });

  return { 
    openaiKey: settings?.openaiKey || "",
    riskDaysCritical: settings?.riskDaysCritical || 14,
    riskDaysWarning: settings?.riskDaysWarning || 30,
    lastPoNumber: settings?.lastPoNumber || 1000,
    syncDraftOrders: settings?.syncDraftOrders || false,
  };
};

export default function Settings() {
  const { openaiKey, riskDaysCritical, riskDaysWarning, lastPoNumber, syncDraftOrders } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const navigate = useNavigate();
  
  const [key, setKey] = useState(openaiKey);
  const [critical, setCritical] = useState(riskDaysCritical);
  const [warning, setWarning] = useState(riskDaysWarning);
  
  // PO State
  const [poNumber, setPoNumber] = useState(lastPoNumber);
  const [isSyncEnabled, setIsSyncEnabled] = useState(syncDraftOrders);

  const isSaving = navigation.state === "submitting";

  return (
    <Page 
      title="App Configuration" 
      backAction={{ content: "Dashboard", onAction: () => navigate("/app" + window.location.search) }}
    >
      <Layout>
        <Layout.AnnotatedSection
          title="Purchase Orders"
          description="Configure how Stockflow generates POs and syncs with Shopify."
        >
          <Card>
            <BlockStack gap="400">
              <Form method="post">
                <FormLayout>
                  <Text variant="headingSm" as="h3">Sequencing</Text>
                  <TextField
                    label="Next PO Number"
                    type="number"
                    name="lastPoNumber"
                    value={poNumber}
                    onChange={setPoNumber}
                    helpText="The next generated PO will use this number (e.g., PO-1001)."
                  />

                  <Box paddingBlockStart="200">
                    <Checkbox
                      label="Sync to Shopify as Draft Order"
                      name="syncDraftOrders"
                      checked={isSyncEnabled}
                      onChange={setIsSyncEnabled}
                      helpText="If checked, generating a PO will creates a Draft Order in Shopify for your records."
                    />
                  </Box>

                  <Divider />

                  <Text variant="headingSm" as="h3">AI & Risk Analysis</Text>
                  <TextField
                    label="OpenAI API Key"
                    type="password"
                    name="openaiKey"
                    value={key}
                    onChange={setKey}
                    autoComplete="off"
                  />
                  
                  <FormLayout.Group>
                    <TextField
                      label="Critical Risk (Red)"
                      type="number"
                      name="riskDaysCritical"
                      value={critical}
                      onChange={setCritical}
                      suffix="days"
                    />
                    <TextField
                      label="Warning Risk (Yellow)"
                      type="number"
                      name="riskDaysWarning"
                      value={warning}
                      onChange={setWarning}
                      suffix="days"
                    />
                  </FormLayout.Group>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button submit variant="primary" loading={isSaving}>
                      Save Configuration
                    </Button>
                  </div>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.AnnotatedSection>
      </Layout>
    </Page>
  );
}