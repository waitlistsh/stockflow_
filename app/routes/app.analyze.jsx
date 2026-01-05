// app/routes/app.analyze.jsx
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import OpenAI from "openai";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Banner,
  Link,
  Spinner,
  Box
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  // This helper needs the shop and host params to stay in the URL
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productTitle = url.searchParams.get("product");
  const velocity = url.searchParams.get("velocity");
  const stock = url.searchParams.get("stock");

  // Fetch the key from your database settings
  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  if (!settings?.openaiKey) {
    return { error: "NO_KEY" };
  }

  try {
    const openai = new OpenAI({ apiKey: settings.openaiKey });
    
    const prompt = `
      Act as an Inventory Expert for a Shopify Store. 
      Product: "${productTitle}"
      Current Stock: ${stock} units
      Sales Rate: ${velocity} units/day.
      
      Provide advice in exactly this format:
      Summary: [One sentence summary]
      Action 1: [Actionable step]
      Action 2: [Actionable step]
      Action 3: [Actionable step]
    `;

    const completion = await openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-3.5-turbo",
    });

    return { 
      rawAdvice: completion.choices[0].message.content,
      productTitle,
      stats: { stock, velocity }
    };

  } catch (err) {
    return { error: err.message };
  }
};

export default function Analyze() {
  const data = useLoaderData();
  const navigation = useNavigation();
  
  // This detects if the AI is currently "thinking"
  const isLoading = navigation.state === "loading";

  if (isLoading) {
    return (
      <Page>
        <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '50vh', alignItems: 'center', gap: '20px'}}>
          <Spinner accessibilityLabel="Consulting AI" size="large" />
          <Text variant="headingMd" as="h2">Consulting AI Inventory Expert...</Text>
        </div>
      </Page>
    );
  }

  if (data.error === "NO_KEY") {
    return (
      <Page title="AI Analysis" backAction={{ url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Banner title="OpenAI Key Missing" tone="warning">
              <p>
                You need to configure your API key before using this feature.
                {' '}<Link url="/app/settings">Go to Settings</Link>
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (data.error) {
    return (
      <Page title="AI Analysis" backAction={{ url: "/app" }}>
        <Banner title="Error generating report" tone="critical">
          <p>{data.error}</p>
        </Banner>
      </Page>
    );
  }

  const lines = data.rawAdvice ? data.rawAdvice.split('\n').filter(line => line.trim() !== '') : [];

  return (
    <Page 
      title={`Analysis: ${data.productTitle}`} 
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingLg" as="h2">Consultant Report</Text>
              
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text variant="bodyMd" as="p">
                  <strong>Context:</strong> You have <strong>{data.stats.stock}</strong> units in stock selling <strong>{data.stats.velocity}</strong> per day.
                </Text>
              </Box>

              <BlockStack gap="300">
                {lines.map((line, index) => (
                   <div key={index} style={{ borderLeft: '3px solid #008060', paddingLeft: '15px' }}>
                      <Text as="p" variant="bodyLg">{line}</Text>
                   </div>
                ))}
              </BlockStack>
              
              <Text variant="caption" tone="subdued">
                Powered by OpenAI GPT-3.5 • Analysis generated on {new Date().toLocaleDateString()}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

