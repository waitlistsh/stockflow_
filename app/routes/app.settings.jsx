// app/routes/app.settings.jsx
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// 1. SAVE THE KEY (Action)
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const openaiKey = formData.get("openaiKey");

  // Save to database (Upsert = Create if new, Update if exists)
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
  const isSaving = navigation.state === "submitting";

  return (
    <div style={{ padding: "40px", maxWidth: "600px" }}>
      <h1>⚙️ AI Settings</h1>
      <p>Enter your OpenAI API Key to unlock the "Consultant" features.</p>
      
      <div style={{ 
        background: "white", 
        padding: "20px", 
        borderRadius: "8px", 
        boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
        marginTop: "20px" 
      }}>
        <Form method="post">
          <label style={{ display: "block", marginBottom: "10px", fontWeight: "bold" }}>
            OpenAI API Key (starts with sk-...)
          </label>
          <input 
            type="password" 
            name="openaiKey" 
            defaultValue={openaiKey}
            placeholder="sk-..."
            style={{ 
              width: "100%", 
              padding: "10px", 
              marginBottom: "20px",
              border: "1px solid #ccc",
              borderRadius: "4px"
            }} 
          />
          
          <button 
            type="submit" 
            disabled={isSaving}
            style={{ 
              background: "#008060", 
              color: "white", 
              padding: "10px 20px", 
              border: "none", 
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </Form>
        
        {actionData?.status === "saved" && (
          <p style={{ color: "green", marginTop: "10px" }}>✅ API Key saved successfully!</p>
        )}
      </div>

      <div style={{ marginTop: "20px" }}>
        <a href="/app" style={{ color: "#008060", textDecoration: "none" }}>&larr; Back to Dashboard</a>
      </div>
    </div>
  );
}