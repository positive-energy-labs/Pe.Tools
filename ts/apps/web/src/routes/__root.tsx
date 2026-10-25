import { useEffect, useState } from "react";
import { TeachPage, TeachReference, TeachTarget } from "@pe/kit/lang/use-teach";
import { HelpWorld } from "#/route/help";
import { referenceTeaching, STARTUP_TEACHING, SHELL_REGIONS } from "#/route/teaching";
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
                    <div
                      aria-label={SHELL_REGIONS.workspace.label}
                      className="min-h-0 min-w-0 flex-1"
                    >
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
    return <TeachPage value={pathname}>{children ?? <Outlet />}</TeachPage>;
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const reference = hydrated ? referenceTeaching(pathname) : STARTUP_TEACHING;
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
                  <TeachTarget value={pathname}>
                    <TeachReference value={reference}>
                      <RemoteDeviceGate
                        name="Positive Energy Tools"
                        guidance={<HelpWorld facts={reference} />}
                      >
                        {children}
                        <AppUtilities />
                      </RemoteDeviceGate>
                    </TeachReference>
                  </TeachTarget>
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
