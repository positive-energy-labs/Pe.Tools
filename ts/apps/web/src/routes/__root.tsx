import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { RegistryContext } from "@effect/atom-react";

import { inspectAtomRegistry } from "../state/atom-inspect";
import { appAtomRegistry, routeSearch } from "../route/route-owner";
import { AppChrome, AppDevtools } from "../route/app-chrome";

import appCss from "../styles.css?url";

if (import.meta.env.DEV)
  Object.assign(globalThis, { __PE_INSPECT__: inspectAtomRegistry(appAtomRegistry) });

interface MyRouterContext {}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
  validateSearch: routeSearch,
  // The URL carries the thread (its head is the target store) and a `?target` pin across every link.
  search: { middlewares: [retainSearchParams(["thread", "target"])] },
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
      { rel: "manifest", href: "/manifest.json" },
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
  return (
    <div className="h-dvh min-h-0 min-w-0">
      <Outlet />
    </div>
  );
}

function Chrome() {
  const location = useRouterState({ select: (state) => state.location });
  return (
    <>
      <AppChrome pathname={location.pathname} />
      <AppDevtools pathname={location.pathname} shell={String(location.search.shell ?? "")} />
    </>
  );
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
          <Chrome />
        </RegistryContext.Provider>
        <Scripts />
      </body>
    </html>
  );
}
