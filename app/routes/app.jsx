// app/routes/app.jsx
import { Link, Outlet, useLoaderData, useRouteError, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider, Frame, Navigation } from '@shopify/polaris';
import { HomeIcon, ProductIcon, SettingsIcon } from '@shopify/polaris-icons';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

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
                
                // --- THE FIX IS HERE ---
                // We take the current URL params (?shop=...) and stick them onto the next URL
                const targetUrl = `${url}${location.search}`;
                navigate(targetUrl);
                // -----------------------
              }}
              {...rest}
            >
              {children}
            </a>
          );
        }}
      >
        <NavMenu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/analyze">Inventory Analysis</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>

        <Frame
          navigation={
            <Navigation location={location.pathname}>
              <Navigation.Section
                items={[
                  {
                    url: "/app",
                    label: "Home",
                    icon: HomeIcon,
                    selected: location.pathname === "/app",
                  },
                  {
                    url: "/app/analyze",
                    label: "Inventory Analysis",
                    icon: ProductIcon, 
                    selected: location.pathname.startsWith("/app/analyze"),
                  },
                  {
                    url: "/app/settings",
                    label: "Settings",
                    icon: SettingsIcon,
                    selected: location.pathname.startsWith("/app/settings"),
                  }
                ]}
              />
            </Navigation>
          }
        >
          <Outlet />
        </Frame>

      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Keep the standard ErrorBoundary and headers
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