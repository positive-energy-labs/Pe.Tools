import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";

import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { Verb } from "../components/lang/verb";
import { useHostLiveInvalidation } from "../host/live";
import { inspectAtomRegistry } from "../state/atom-inspect";
import { appAtomRegistry } from "../state/registry";
import { routeConflictAtom } from "../state/route-store";
import { routeScopeSearch } from "../workbench/route-scope";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

if (import.meta.env.DEV)
  Object.assign(globalThis, { __PE_INSPECT__: inspectAtomRegistry(appAtomRegistry) });

interface MyRouterContext {
  queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
  validateSearch: routeScopeSearch,
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Positive Energy — Tools",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

export function RootComponent() {
  const fixture = useLocation({ select: (location) => location.search.source === "fixture" });
  return (
    <>
      {!fixture && <HostLiveInvalidation />}
      <Outlet />
    </>
  );
}

function HostLiveInvalidation() {
  useHostLiveInvalidation();
  return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-pe suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <RegistryContext.Provider value={appAtomRegistry}>
          {children}
          <RouteConflictBanner />
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        </RegistryContext.Provider>
        <Scripts />
      </body>
    </html>
  );
}

export function RouteConflictBanner() {
  const changed = useAtomValue(routeConflictAtom);
  const dismiss = useAtomSet(routeConflictAtom);
  if (!changed) return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      className="z-notice flex items-center justify-center gap-3 px-4 py-2"
    >
      <strong>Changed elsewhere</strong>
      <span>Your edit did not land. Review the current document and retry.</span>
      <Verb label="dismiss" reason="Dismiss this conflict notice." onClick={() => dismiss(false)} />
    </aside>
  );
}
