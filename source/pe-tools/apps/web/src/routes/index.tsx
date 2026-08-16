import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  DownloadCloud,
  FileScan,
  Boxes,
  LayoutGrid,
  Link2,
  Map,
  LoaderCircle,
  MessageSquare,
  Palette,
  Server,
  Settings2,
  Table,
  Table2,
  Terminal,
} from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";

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
        <span className="text-xs text-muted-foreground">v{installed.data.releaseVersion}</span>
      )}
      {available.data?.error && (
        <span className="text-xs text-muted-foreground">update check unavailable</span>
      )}
      {update.isSuccess && (
        <span className="text-xs text-muted-foreground">
          {update.data.changed
            ? `updated to ${update.data.releaseVersion} — staged for the next Revit start; this Revit keeps its loaded version`
            : `already on the latest version (${update.data.releaseVersion})`}
        </span>
      )}
      {update.isError && (
        <span className="text-xs text-destructive">
          {String(update.error?.message ?? update.error)}
        </span>
      )}
      {installed.data?.releaseVersion &&
        (available.data?.updateAvailable || update.isPending) &&
        !update.isSuccess && (
          <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <DownloadCloud className="size-4" />
            )}
            {update.isPending ? "Updating…" : "Update"}
          </Button>
        )}
    </div>
  );
}

export const Route = createFileRoute("/")({ component: App });

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
      "Every Revit world the bridge and sandbox registry know about — your own session, pea-owned sandboxes you start and stop, and the ledger of what happened.",
  },
  {
    to: "/design-system",
    title: "Design System",
    label: "Design language",
    icon: Palette,
    description:
      "The spec and catalogue for the design language — production components under production tokens, with the gaps they cannot yet express marked in place.",
  },
] as const;

function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="page-wrap flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Positive Energy
            </span>
          </div>
          <div className="flex items-center gap-3">
            <UpdateButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="page-wrap py-16">
        <section className="max-w-2xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Internal tools · Update proof 0.6.22
          </p>
          <h1 className="font-pe-display text-5xl font-semibold leading-tight tracking-tight text-foreground">
            Healthy people, healthy planet.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            A small workbench of internal tools — the Pea agent, Revit data, and the host pipeline.
            Pick one to get started.
          </p>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Card
              key={tool.to}
              render={<Link to={tool.to} />}
              className="group flex flex-col gap-3 p-5 transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <tool.icon className="size-4.5" />
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <div>
                <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {tool.label}
                </p>
                <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
                  {tool.title}
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{tool.description}</p>
              </div>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}
