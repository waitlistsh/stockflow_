// app/routes/app.jsx
import { Outlet, useLoaderData, useRouteError, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { authenticate } from "../shopify.server";


export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// 👇 THIS EXPORT IS MISSING IN YOUR FILE 👇
export const meta = ({ data }) => {
  return [
    { name: "shopify-api-key", content: data?.apiKey || "" }
  ];
};
// ----------------------------------------

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <PolarisAppProvider 
        i18n={enTranslations} 
        linkComponent={({ children, url, ...rest }) => {
          return (
            <a
              href={url}
              onClick={(e) => {
                e.preventDefault();
                const targetUrl = url.includes('?') 
                  ? `${url}&${location.search.substring(1)}` 
                  : `${url}${location.search}`;
                navigate(targetUrl);
              }}
              {...rest}
            >
              {children}
            </a>
          );
        }}
      >
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