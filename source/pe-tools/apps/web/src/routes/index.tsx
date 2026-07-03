import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  FileScan,
  MessageSquare,
  PencilRuler,
  Settings2,
  Table2,
  Terminal,
} from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { Card } from "#/components/ui/card";

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
    to: "/settings-prototype",
    title: "Settings",
    label: "Host pipeline",
    icon: Settings2,
    description: "Schema-driven authoring forms validated and saved through the host.",
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
          <ThemeToggle />
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
