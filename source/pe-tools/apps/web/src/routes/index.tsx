import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  DownloadCloud,
  FileScan,
  Boxes,
  History,
  LayoutGrid,
  Link2,
  Map,
  MessageSquare,
  Palette,
  Server,
  Settings2,
  Table,
  Table2,
  Terminal,
} from "lucide-react";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Card } from "#/components/lang/card";

type InstallStatus = {
  installed: boolean;
  releaseVersion: string | null;
};

async function readInstallStatus(): Promise<InstallStatus> {
  const response = await fetch("/host/install");
  if (!response.ok) throw new Error(`install status failed (${response.status})`);
  return response.json() as Promise<InstallStatus>;
}

async function waitForVersionChange(previousVersion: string | null): Promise<string> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      const next = await readInstallStatus();
      if (next.releaseVersion && next.releaseVersion !== previousVersion)
        return next.releaseVersion;
    } catch {
      // The old host exits after commit; retry until its replacement owns the service.
    }
  }
  throw new Error("Update started, but the new host did not come back within 3 minutes.");
}

/** Acknowledge the update before the versioned host restarts, then poll the receipt until the
 * replacement host proves the new release. The Revit add-in remains staged until Revit restarts. */
function UpdateButton() {
  const installed = useQuery({
    queryKey: ["host-install"],
    queryFn: readInstallStatus,
  });
  const available = useQuery({
    queryKey: ["host-update"],
    queryFn: async () => {
      const response = await fetch("/host/update");
      if (!response.ok) throw new Error(`update check failed (${response.status})`);
      return response.json() as Promise<{
        installedVersion: string | null;
        latestVersion: string | null;
        updateAvailable: boolean;
        error?: string;
      }>;
    },
  });
  const update = useMutation({
    mutationFn: async () => {
      const previousVersion =
        installed.data?.releaseVersion ?? available.data?.installedVersion ?? null;
      if (!previousVersion) throw new Error("Installed version is not available.");
      const res = await fetch("/host/update", { method: "POST" });
      const body = (await res.json()) as {
        accepted?: boolean;
        reason?: string;
        installedVersion?: string | null;
        error?: string;
      };
      if (res.status === 409 && body.reason === "already-current" && body.installedVersion)
        return { changed: false, releaseVersion: body.installedVersion };
      if (!res.ok || body.accepted !== true)
        throw new Error(body.error ?? `update failed (${res.status})`);
      return { changed: true, releaseVersion: await waitForVersionChange(previousVersion) };
    },
    onSuccess: async () => {
      await Promise.all([installed.refetch(), available.refetch()]);
    },
  });

  return (
    <div className="flex items-center gap-2">
      {installed.data?.releaseVersion && (
        <FactChip title="the host release currently installed as a service">
          v{installed.data.releaseVersion}
        </FactChip>
      )}
      {available.data?.error && <OutcomeLine kind="advisory" label="update check unavailable" />}
      {update.isSuccess &&
        (update.data.changed ? (
          <OutcomeLine
            kind="receipt"
            label={`updated to ${update.data.releaseVersion}`}
            says="staged for the next Revit start; this Revit keeps its loaded version"
          />
        ) : (
          <OutcomeLine
            kind="advisory"
            label={`already on ${update.data.releaseVersion}`}
            says="the latest release is installed"
          />
        ))}
      {update.isError && (
        <OutcomeLine kind="error" label={String(update.error?.message ?? update.error)} />
      )}
      {installed.data?.releaseVersion &&
        (available.data?.updateAvailable || update.isPending) &&
        !update.isSuccess && (
          <Verb
            tone="commit"
            label="update"
            icon={DownloadCloud}
            busy={update.isPending}
            disabled={update.isPending}
            onClick={() => update.mutate()}
            reason="Download and install the latest host release — the running Revit keeps its loaded add-in until it restarts"
          />
        )}
    </div>
  );
}

export const Route = createFileRoute("/")({ component: App });

/** The front door lists every product and incubating-product route (SURFACE-PHILOSOPHY §0:
 * an undiscoverable product rots). Explicitly round-scoped throwaway experiments may remain
 * typed-URL-only while still paying the maintained styling guard. `/design-system`'s satellite
 * exhibits are reachable through the satellite links on its card. */
const TOOLS = [
  {
    to: "/family",
    title: "Family",
    label: "Family Foundry",
    icon: Boxes,
    description:
      "One family, two lanes: an authored family.json (anatomy, matrix, build) or the family open in Revit's editor. Binding picks the lane; capture bridges them.",
  },
  {
    to: "/chat",
    title: "Chat",
    label: "Workbench",
    icon: MessageSquare,
    description: "The Pea agent workbench — chat, trace, and the context world inspector.",
  },
  {
    to: "/families",
    title: "Families",
    label: "Family Foundry",
    icon: Table2,
    description:
      "Every loaded family's types × parameters in one table — audit it against a profile, plan the reconciliation, apply with receipts.",
  },
  {
    to: "/takeoffs",
    title: "Takeoffs",
    label: "Manual J",
    icon: Map,
    description:
      "The takeoff atlas — zones on the plan, rooms in the table, Manual J data through to a synced RHVAC .r10.",
  },
  {
    to: "/grilles",
    title: "Grilles",
    label: "Wood floor grille",
    icon: LayoutGrid,
    description:
      "The custom wood floor grille calculator — profiles in a sheet, the active one drawn to submittal scale, the buildable field charted; export a sheet to PDF or .svg.",
  },
  {
    to: "/settings",
    title: "Settings",
    label: "Host pipeline",
    icon: Settings2,
    description:
      "Schema-backed host settings — pea proposes field values, you review, stage, validate, and save.",
  },
  {
    to: "/doc-lab",
    title: "Doc Lab",
    label: "Experimental",
    icon: FileScan,
    description:
      "The grounded-document engine in isolation — parsed markdown beside the PDF pages, hover either side to link them.",
  },
  {
    to: "/ops",
    title: "Ops Playground",
    label: "Host API",
    icon: Terminal,
    description: "Call any host operation directly and inspect the raw response.",
  },
  {
    to: "/schedule-grid",
    title: "Schedule Grid",
    label: "Revit data",
    icon: LayoutGrid,
    description:
      "Any Revit schedule as an editable grid — pea proposes cell values, you review, stage, and push them back to the document.",
  },
  {
    to: "/data-tables",
    title: "Data Tables",
    label: "Revit data",
    icon: Table,
    description:
      "Author synthetic data tables — draft columns and keyed rows, then upsert them in one apply; rows deleted here are pruned in Revit.",
  },
  {
    to: "/param-tables",
    title: "Parameter Tables",
    label: "Incubating product",
    icon: Table2,
    description:
      "Five mounted parameter-table variants for linked engineering data; switch between them while the product shape is incubating.",
  },
  {
    to: "/parameter-links",
    title: "Parameter Links",
    label: "Revit data",
    icon: Link2,
    description:
      "Cross-element parameter links — co-edit the link profile with pea, preview the projected target writes, then apply to reconcile them.",
  },
  {
    to: "/instances",
    title: "Instances",
    label: "Fleet",
    icon: Server,
    description:
      "Every Revit world pe-revit and the bridge know about — the sessions pea controls and starts and stops, the one it only observes (your own Revit), each session's companion legs, and the ledger of what happened.",
  },
  {
    to: "/design-system",
    title: "Design System",
    label: "Design language",
    icon: Palette,
    description:
      "The spec and catalogue for the design language — production components under production tokens, with the gaps they cannot yet express marked in place.",
    satellites: [
      { to: "/design-system/proposal-flow", label: "proposal-flow" },
      { to: "/design-system/arming", label: "arming" },
      { to: "/design-system/popovers", label: "popovers" },
      { to: "/design-system/swatch", label: "swatch" },
    ],
  },
] as const;

/** Surfaces the dev server serves but a shipped build does not — listed only under DEV so the
 * directory never advertises a route that 403s. */
const DEV_TOOLS = [
  {
    to: "/runs",
    title: "Runs",
    label: "Manual J · dev only",
    icon: History,
    description:
      "The takeoff run browser — every persisted solver run as a sheet of zone cards, A/B against its predecessor by default, with the plan and the run ledger docked.",
  },
] as const;

function App() {
  const tools = import.meta.env.DEV ? [...TOOLS, ...DEV_TOOLS] : TOOLS;
  return (
    <div className="min-h-screen">
      <header>
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <span className="size-2" />
            <span className="t-value text-ink">Positive Energy</span>
          </div>
          <div className="flex items-center gap-3">
            <UpdateButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="py-16">
        <section className="max-w-2xl">
          <p className="t-label mb-3 text-ink-2">
            <span className="t-upper">Internal tools</span> ·{" "}
            <span className="face-mono">update proof 0.6.22</span>
          </p>
          <h1 className="t-display face-display text-ink">Healthy people, healthy planet.</h1>
          <p className="t-prose mt-4 text-ink-2">
            A small workbench of internal tools — the Pea agent, Revit data, and the host pipeline.
            Pick one to get started.
          </p>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <div key={tool.to} className="flex flex-col gap-1.5 [&>[data-slot=card]]:flex-1">
              <Card render={<Link to={tool.to} />}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-9 items-center justify-center">
                    <tool.icon className="size-4.5" />
                  </span>
                  <ArrowUpRight className="size-4 text-ink-2" />
                </div>
                <div>
                  <p className="t-caption t-upper text-ink-2">{tool.label}</p>
                  <h2 className="t-title mt-0.5 text-ink">{tool.title}</h2>
                  <p className="t-prose mt-1.5 text-ink-2">{tool.description}</p>
                </div>
              </Card>
              {"satellites" in tool && (
                <p className="t-caption face-mono flex flex-wrap gap-x-2 px-1 text-ink-2">
                  {tool.satellites.map((satellite) => (
                    <Link key={satellite.to} to={satellite.to}>
                      /{satellite.label}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
