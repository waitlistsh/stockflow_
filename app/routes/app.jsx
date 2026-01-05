// app/routes/app.jsx
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

// 1. IMPORT THE TRANSLATIONS (The Dictionary)
import polarisTranslations from "@shopify/polaris/locales/en.json";

// 2. IMPORT THE STYLES (The CSS)
import "@shopify/polaris/build/esm/styles.css";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    // 3. PASS THE TRANSLATIONS TO THE PROVIDER
    <AppProvider isEmbeddedApp apiKey={apiKey} i18n={polarisTranslations}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Error handling boundary
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};