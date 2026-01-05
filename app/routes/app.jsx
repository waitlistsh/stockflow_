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
      {/* 1. PolarisAppProvider MUST wrap everything to provide i18n/context */}
      <PolarisAppProvider i18n={enTranslations}>
        
        {/* 2. NavMenu handles the sidebar submenu in the Shopify Admin */}
        <NavMenu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/analyze">Inventory Analysis</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>

        {/* 3. Outlet renders the content of your pages (Home, Settings, Analyze) */}
        <Outlet />
        
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

export function ErrorBoundary() {
  return (
    <PolarisAppProvider i18n={enTranslations}>
      {boundary.error(useRouteError())}
    </PolarisAppProvider>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};