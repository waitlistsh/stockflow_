// app/routes/app.analyze.jsx
import { useLoaderData, useNavigation, Link as RemixLink } from "react-router";
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
  List,
  Spinner,
  Box
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  
  const productTitle = url.searchParams.get("product");
  const velocity = url.searchParams.get("velocity");
  const stock = url.searchParams.get("stock");

  const settings = await prisma.merchantSettings.findUnique({
    where: { shop: session.shop }
  });

  if (!settings?.openaiKey) {
    return { error: "NO_KEY" };
  }

  try {
    const openai = new OpenAI({ apiKey: settings.openaiKey });
    
    // We ask for the response in a specific format to parse it easily later
    const prompt = `
      Act as an Inventory Expert. 
      Product: "${productTitle}"
      Current Stock: ${stock} units
      Sales Rate: ${velocity} units/day.
      
      Provide advice in exactly this format:
      Summary: [One sentence summary of the situation]
      Action 1: [First actionable step]
      Action 2: [Second actionable step]
      Action 3: [Third actionable step]
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
  const isLoading = navigation.state === "loading";

  if (isLoading) {
    return (
      <Page>
        <div style={{display: 'flex', justifyContent: 'center', height: '50vh', alignItems: 'center'}}>
          <Spinner accessibilityLabel="Consulting AI" size="large" />
        </div>
      </Page>
    );
  }

  // Handle Missing Key Error
  if (data.error === "NO_KEY") {
    return (
      <Page title="AI Analysis">
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

  // Handle Other Errors
  if (data.error) {
    return (
      <Page title="AI Analysis">
        <Banner title="Error generating report" tone="critical">
          <p>{data.error}</p>
        </Banner>
      </Page>
    );
  }

  // Parse the AI response (Simple splitting by newlines for cleaner UI)
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
                  <strong>Context:</strong> With <strong>{data.stats.stock}</strong> units in stock and selling <strong>{data.stats.velocity}</strong> per day.
                </Text>
              </Box>

              <BlockStack gap="200">
                {lines.map((line, index) => (
                   <Text as="p" key={index} variant="bodyLg">{line}</Text>
                ))}
              </BlockStack>
              
              <Text variant="caption" tone="subdued">
                Powered by OpenAI GPT-3.5
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}