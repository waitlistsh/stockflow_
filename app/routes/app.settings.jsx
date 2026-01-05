// app/routes/app.settings.jsx
import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation, Link } from "react-router";
import { 
  Page, 
  Layout, 
  Card, 
  FormLayout, 
  TextField, 
  Button, 
  BlockStack,
  Text,
  Banner 
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

<Link to="/app/settings">Settings</Link>



// 1. SAVE THE KEY (Action)
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const openaiKey = formData.get("openaiKey");

  await prisma.merchantSettings.upsert({
    where: { shop: session.shop },
    update: { openaiKey },
    create: { shop: session.shop, openaiKey }
  });

  return { status: "saved" };
};

// 2. LOAD EXISTING KEY (Loader)
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  return { 
    openaiKey: settings?.openaiKey || "" 
  };
};

// 3. THE UI
export default function Settings() {
  const { openaiKey } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  
  // Polaris TextFields need local state to handle typing
  const [key, setKey] = useState(openaiKey);
  const isSaving = navigation.state === "submitting";

  return (
    <Page 
      title="AI Settings" 
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.AnnotatedSection
          title="OpenAI Configuration"
          description="Enter your API Key to enable the AI Consultant features."
        >
          <Card>
            <BlockStack gap="400">
              {actionData?.status === "saved" && (
                <Banner title="Settings saved successfully" tone="success" />
              )}
              
             <Text as="p" variant="bodyMd">
                You can find your API key in your{" "}
                <Link url="https://platform.openai.com/api-keys" external>
                  OpenAI Dashboard
                </Link>.
              </Text>

              {/* We use the Remix Form, but with Polaris components inside */}
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="API Key"
                    type="password"
                    name="openaiKey"
                    value={key}
                    onChange={(newValue) => setKey(newValue)}
                    autoComplete="off"
                    helpText="Starts with sk-..."
                  />
                  
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button submit variant="primary" loading={isSaving}>
                      Save Settings
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