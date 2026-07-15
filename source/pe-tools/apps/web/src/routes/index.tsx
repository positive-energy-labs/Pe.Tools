import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  DownloadCloud,
  FileScan,
  LoaderCircle,
  MessageSquare,
  PencilRuler,
  Settings2,
  Table2,
  Terminal,
} from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";

/** One-click update: the host runs `pe-revit install apply --release latest`; open Revit
 * sessions live-swap via the loader when the version pointer flips. */
function UpdateButton() {
  const installed = useQuery({
    queryKey: ["host-install"],
    queryFn: async () =>
      (await fetch("/host/install")).json() as Promise<{
        installed: boolean;
        releaseVersion: string | null;
      }>,
  });
  const update = useMutation({
    mutationFn: async () => {
      const res = await fetch("/host/update", { method: "POST" });
      // The relayed pe-revit envelope: { result: {...}, diagnostics: [{code, detail}] }.
      // Pre-envelope CLIs returned the payload at the top level — read both shapes.
      const raw = (await res.json()) as {
        ok?: boolean;
        releaseVersion?: string;
        error?: string;
        result?: { ok?: boolean; releaseVersion?: string };
        diagnostics?: ReadonlyArray<{ code?: string; detail?: string }>;
      };
      const body = { ...raw, ...raw.result };
      if (!res.ok || body.ok === false)
        throw new Error(
          body.error ?? raw.diagnostics?.[0]?.detail ?? `update failed (${res.status})`,
        );
      return body;
    },
    onSuccess: () => installed.refetch(),
  });

  return (
    <div className="flex items-center gap-2">
      {installed.data?.releaseVersion && (
        <span className="text-xs text-muted-foreground">v{installed.data.releaseVersion}</span>
      )}
      {update.isSuccess && (
        <span className="text-xs text-muted-foreground">
          updated to {update.data.releaseVersion ?? "latest"} — takes effect when Revit restarts;
          open sessions keep their current version
        </span>
      )}
      {update.isError && (
        <span className="text-xs text-destructive">
          {String(update.error?.message ?? update.error)}
        </span>
      )}
      <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
        {update.isPending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <DownloadCloud className="size-4" />
        )}
        {update.isPending ? "Updating…" : "Update"}
      </Button>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: App });

const TOOLS = [
  {
    to: "/chat",
    title: "Chat",
    label: "Workbench",
    icon: MessageSquare,
    description: "The Pea agent workbench — chat, trace, and the context world inspector.",
  },
  {
    to: "/family-matrix",
    title: "Family Matrix",
    label: "Revit data",
    icon: Table2,
    description: "Parameter values across loaded Revit family types, as a scannable matrix.",
  },
  {
    to: "/family-types",
    title: "Family Types",
    label: "Revit editor",
    icon: PencilRuler,
    description:
      "A web Family Types dialog — pea proposes spec-sheet values with provenance; you review, stage, and push to Revit.",
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
    to: "/family-audit",
    title: "Family Audit",
    label: "Experimental",
    icon: FileScan,
    description:
      "Audit one loaded family against a PDF — hover any mapped cell to see where in the document it came from.",
  },
  {
    to: "/family-doc",
    title: "Family Doc Audit",
    label: "Experimental",
    icon: PencilRuler,
    description:
      "Read and edit the open family document's parameters, with PDF-grounded value proposals applied via the scripting lane.",
  },
  {
    to: "/ops",
    title: "Ops Playground",
    label: "Host API",
    icon: Terminal,
    description: "Call any host operation directly and inspect the raw response.",
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
            Internal tools
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
