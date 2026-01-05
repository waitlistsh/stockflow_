// app/routes/app.settings.jsx
import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation, useNavigate } from "react-router"; // Added useNavigate
import { 
  Page, Layout, Card, FormLayout, TextField, Button, BlockStack, Text, Banner, Box 
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// ... (Keep Action & Loader exactly as they were) ...
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const openaiKey = formData.get("openaiKey");
  const riskDaysCritical = parseInt(formData.get("riskDaysCritical") || "14");
  const riskDaysWarning = parseInt(formData.get("riskDaysWarning") || "30");

  await prisma.merchantSettings.upsert({
    where: { shop: session.shop },
    update: { openaiKey, riskDaysCritical, riskDaysWarning },
    create: { shop: session.shop, openaiKey, riskDaysCritical, riskDaysWarning }
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
  };
};

export default function Settings() {
  const { openaiKey, riskDaysCritical, riskDaysWarning } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const navigate = useNavigate(); // Hook for navigation
  
  const [key, setKey] = useState(openaiKey);
  const [critical, setCritical] = useState(riskDaysCritical);
  const [warning, setWarning] = useState(riskDaysWarning);

  const isSaving = navigation.state === "submitting";

  return (
    <Page 
      title="App Configuration" 
      backAction={{ 
        content: "Dashboard", 
        onAction: () => navigate("/app" + window.location.search) 
      }}
    >
      <Layout>
        <Layout.AnnotatedSection
          title="AI Consultant"
          description="Enter your OpenAI API Key to enable executive reporting."
        >
          <Card>
            <BlockStack gap="400">
              {actionData?.status === "saved" && (
                <Banner title="Settings saved" tone="success" />
              )}
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="OpenAI API Key"
                    type="password"
                    name="openaiKey"
                    value={key}
                    onChange={setKey}
                    autoComplete="off"
                    helpText="Required for AI analysis."
                  />
                  
                  <Box paddingBlockStart="400">
                     <Text variant="headingSm" as="h3">Risk Thresholds (Runway Days)</Text>
                     <Text variant="bodySm" tone="subdued">Define when inventory levels should be flagged.</Text>
                  </Box>

                  <FormLayout.Group>
                    <TextField
                      label="Critical Risk (Red)"
                      type="number"
                      name="riskDaysCritical"
                      value={critical}
                      onChange={setCritical}
                      suffix="days"
                      helpText="Items with less than this runway are Critical."
                    />
                    <TextField
                      label="Warning Risk (Yellow)"
                      type="number"
                      name="riskDaysWarning"
                      value={warning}
                      onChange={setWarning}
                      suffix="days"
                      helpText="Items with less than this runway are Warnings."
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