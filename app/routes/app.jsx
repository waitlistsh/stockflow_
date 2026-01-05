// app/routes/app.jsx
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};
export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        
        {/* 1. This handles the sidebar on the left */}
        <NavMenu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/analyze">Inventory Analysis</Link>
        </NavMenu>

        {/* 2. Remove the <div> with manual links that was here! */}

        <Outlet />
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}
// --- FIX STARTS HERE ---
export function ErrorBoundary() {
  return (
    // We must wrap the error boundary in the Polaris Provider so it can render the error UI
    <PolarisAppProvider i18n={enTranslations}>
      {boundary.error(useRouteError())}
    </PolarisAppProvider>
  );
}
// --- FIX ENDS HERE ---

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};