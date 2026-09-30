import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";
import { createAuthenticatedFetch } from "../authenticated-fetch";

import { authenticate } from "../shopify.server";
import "../styles/trade-accounts.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  useEffect(() => {
    const previousFetch = window.fetch;
    const authenticatedFetch = createAuthenticatedFetch(previousFetch.bind(window), window.location.origin, () => shopify.idToken());
    window.fetch = authenticatedFetch;
    return () => {
      if (window.fetch === authenticatedFetch) window.fetch = previousFetch;
    };
  }, [shopify]);

  return (
    <AppProvider apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/demo">Owner Demo</Link>
        <Link to="/app/accounts">Trade Accounts</Link>
        <Link to="/app/allocations">Allocation Workbench</Link>
        <Link to="/app/statements">Statements</Link>
        <Link to="/app/onboarding">Onboarding</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
