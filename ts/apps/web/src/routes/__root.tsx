import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  retainSearchParams,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { RegistryContext } from "@effect/atom-react";
import { DownloadCloud } from "lucide-react";
import { useState } from "react";

import { OwnerInspector } from "../state/owner-inspector";
import { ActionButton } from "../components/lang/action-button";
import { useAction, useHostCall } from "#/readings";
import { inspectAtomRegistry } from "../state/atom-inspect";
import { appAtomRegistry, routeSearch } from "../route/route-owner";
import {
  acknowledgeUpdate,
  readInstallStatus,
  readUpdateAvailability,
  waitForVersionChange,
} from "../host/install";
import { FactChip } from "../components/lang/chip";
import { OutcomeLine } from "../components/lang/outcome";
import { FeedbackPicker } from "../components/feedback-picker";

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
          <UpdateButton />
          <FeedbackPicker />
          <TanStackDevtools
            config={{
              position: "middle-left",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              { name: "Route owners", render: <OwnerInspector /> },
            ]}
          />
        </RegistryContext.Provider>
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Acknowledge the update before the versioned host restarts, then poll the receipt until the
 * replacement host proves the new release. The Revit add-in remains staged until Revit restarts.
 *
 * Ruled 2026-09-10 (Q3): this is a fact about the MACHINE the app runs on, not about one route,
 * so it lives at the document root and the route shell keeps only the lamp.
 */
export function UpdateButton() {
  const installed = useHostCall(readInstallStatus, ["host-install"]);
  const available = useHostCall(readUpdateAvailability, ["host-update"]);
  // `useAction` reports pending and error; the receipt itself is this component's own state.
  const [updated, setUpdated] = useState<{ changed: boolean; releaseVersion: string } | null>(null);
  const update = useAction(
    async () => {
      const previousVersion =
        installed.data?.releaseVersion ?? available.data?.installedVersion ?? null;
      if (!previousVersion) throw new Error("Installed version is not available.");
      const body = await acknowledgeUpdate();
      if (body.status === 409 && body.reason === "already-current" && body.installedVersion)
        return { changed: false, releaseVersion: body.installedVersion };
      if (body.status >= 400 || body.accepted !== true)
        throw new Error(body.error ?? `update failed (${body.status})`);
      return { changed: true, releaseVersion: await waitForVersionChange(previousVersion) };
    },
    (result) => {
      setUpdated(result);
      installed.refresh();
      available.refresh();
    },
  );
  return (
    <div className="flex items-center gap-2">
      {installed.data?.releaseVersion && (
        <FactChip title="the host release currently installed as a service">
          v{installed.data.releaseVersion}
        </FactChip>
      )}
      {available.data?.error && <OutcomeLine kind="advisory" label="update check unavailable" />}
      {updated &&
        (updated.changed ? (
          <OutcomeLine
            kind="receipt"
            label={`updated to ${updated.releaseVersion}`}
            says="staged for the next Revit start; this Revit keeps its loaded version"
          />
        ) : (
          <OutcomeLine
            kind="advisory"
            label={`already on ${updated.releaseVersion}`}
            says="the latest release is installed"
          />
        ))}
      {update.error && <OutcomeLine kind="error" label={update.error.message} />}
      {installed.data?.releaseVersion &&
        (available.data?.updateAvailable || update.isPending) &&
        !updated && (
          <ActionButton
            tone="act"
            label="update"
            icon={DownloadCloud}
            busy={update.isPending}
            disabled={update.isPending}
            onClick={() => update.mutate(undefined)}
            reason="Download and install the latest host release — the running Revit keeps its loaded add-in until it restarts"
          />
        )}
    </div>
  );
}
