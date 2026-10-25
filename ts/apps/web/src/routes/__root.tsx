import { PaneFaultProvider } from "@pe/kit/lang/pane";
import { reportFault } from "#/host/diagnostics";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  retainSearchParams,
  useRouterState,
} from "@tanstack/react-router";
import { RegistryContext } from "@effect/atom-react";
import { lazy, Suspense } from "react";

import { inspectAtomRegistry } from "../state/atom-inspect";
import { appAtomRegistry, routeSearch } from "../route/route-owner";
import { AppUtilities } from "../route/app-chrome";
import { NoticeShell } from "#/machine/notice-shell";
import { AppBar } from "#/navigation/app-bar";
import { NavigationProvider } from "#/navigation/state";
import { RouteControlsProvider, SituationPinnedControl } from "#/navigation/route-controls";
import { SurfaceHostProvider } from "#/navigation/surface-host";
import { SettingsProvider } from "#/settings/options";
import { useSurfaceHost } from "#/navigation/surface-host";
import { appRouteMount, appRouteByPath } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { RemoteDeviceGate } from "#/machine/devices";
import { PodRoutesProvider } from "#/route/pod-routes";

import { TooltipProvider } from "@pe/kit/lang/tooltip";
import { ElementMenu } from "#/revit/element-menu";
import { WorkbenchProvider } from "#/workbench/provider";
import { RouteDock } from "#/workbench/route-panes";
import { useRouteActivity } from "#/route/activity";

import appCss from "../styles.css?url";

if (import.meta.env.DEV)
  Object.assign(globalThis, { __PE_INSPECT__: inspectAtomRegistry(appAtomRegistry) });

const KnobsFloater = import.meta.env.DEV ? lazy(() => import("#/knobs/floater")) : null;

interface MyRouterContext {}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
  validateSearch: (
    search: Record<string, unknown>,
  ): ReturnType<typeof routeSearch> & { shell?: "tray" | "card" } => ({
    ...routeSearch(search),
    shell: search.shell === "tray" || search.shell === "card" ? search.shell : undefined,
  }),
  // Resource identity crosses links; shell presentation belongs to the local surface adapter.
  search: { middlewares: [retainSearchParams(["thread", "target", "work"])] },
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
  const shell = useRouterState({ select: (state) => state.location.search.shell });
  if (shell === "card") return <NoticeShell />;
  return (
    <PodRoutesProvider>
      <NavigationProvider>
        <RouteControlsProvider>
          <SettingsProvider>
            <WorkbenchProvider>
              <div className="flex h-dvh min-h-0 min-w-0 flex-col">
                <AppBar />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <div
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto overscroll-none"
                    data-app-content
                  >
                    <SituationPinnedControl />
                    <div className="min-h-0 min-w-0 flex-1">
                      <RouteDock renderRoute={renderSurfaceRoute}>
                        <SurfaceOutlet />
                      </RouteDock>
                    </div>
                  </div>
                </div>
              </div>
              <ElementMenu />
            </WorkbenchProvider>
          </SettingsProvider>
        </RouteControlsProvider>
      </NavigationProvider>
    </PodRoutesProvider>
  );
}

const renderSurfaceRoute = (body: React.ReactNode) => <SurfaceOutlet>{body}</SurfaceOutlet>;

function SurfaceOutlet({ children }: { children?: React.ReactNode }) {
  const host = useSurfaceHost();
  const pathnameNow = useRouterState({ select: (state) => state.location.pathname });
  const scope = useRouteActivity();
  const pathname = scope?.pathname ?? pathnameNow;
  if (host.shell.routes === "all" || appRouteMount(pathname, host.surface))
    return children ?? <Outlet />;
  return (
    <div className="flex flex-col gap-3 p-3">
      <p>{appRouteByPath(pathname)?.label ?? "This tool"} opens in a full window.</p>
      <Button label="Open in full window" onClick={() => host.openFullWindow(window.location.href)}>
        Open in full window
      </Button>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const card = useRouterState({ select: (state) => state.location.search.shell === "card" });
  return (
    <html lang="en" data-pe data-pe-app suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <RegistryContext.Provider value={appAtomRegistry}>
          <PaneFaultProvider onFault={(error) => reportFault({ code: "pane.failed" }, error)}>
            {card ? (
              <TooltipProvider>{children}</TooltipProvider>
            ) : (
              <SurfaceHostProvider>
                <TooltipProvider>
                  <RemoteDeviceGate
                    name="Positive Energy Tools"
                    guidance={
                      <div className="flex max-w-3xl flex-col gap-3">
                        <p>
                          Choose a tool, choose its document, then review the data and proposed
                          changes before applying them.
                        </p>
                        <p>
                          Once connected, Tutorial (Alt+/) explains the current tool and its
                          controls. Document access waits for the host connection and device
                          pairing.
                        </p>
                      </div>
                    }
                  >
                    {children}
                    <AppUtilities />
                  </RemoteDeviceGate>
                </TooltipProvider>
              </SurfaceHostProvider>
            )}
          </PaneFaultProvider>
        </RegistryContext.Provider>
        {KnobsFloater && (
          <Suspense fallback={null}>
            <KnobsFloater />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  );
}
