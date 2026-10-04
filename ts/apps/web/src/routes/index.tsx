import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  FileScan,
  FlaskConical,
  Image,
  Boxes,
  LayoutDashboard,
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

import { RouteShell, emptyManifest } from "#/route";
import { Card } from "#/components/lang/card";

/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
const manifest = emptyManifest("index", "Positive Energy");

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
    to: "/rooms",
    title: "Rooms",
    label: "Manual J",
    icon: LayoutDashboard,
    description:
      "Split a level's plan view into room regions, stage each room's name, type and loads, and write them to the regions in Revit.",
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
    to: "/pods",
    title: "Pods",
    label: "Pods",
    icon: Settings2,
    description:
      "Every installed pod — browse members, edit a spec as a form or raw JSON, and see the runs filed against it.",
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
    to: "/lab",
    title: "Lab",
    label: "Experimental",
    icon: FlaskConical,
    description:
      "Composed glances — many host calls gathered into one drawing, run against a session you pick.",
  },
  {
    to: "/captures",
    title: "Captures",
    label: "Revit data",
    icon: Image,
    description:
      "Every picture taken of a Revit view, newest first — who took it, which view, the receipt, and the URL a page or a chat links.",
  },
  {
    to: "/ops",
    title: "Ops Playground",
    label: "Host API",
    icon: Terminal,
    description: "Call any host operation directly and inspect the raw response.",
  },
  {
    to: "/schedules",
    title: "Schedules",
    label: "Revit data",
    icon: LayoutGrid,
    description:
      "Any Revit schedule as a grid — push staged cell values, capture its definition into a pod, or apply a saved spec as a new schedule.",
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
    to: "/settings",
    title: "Settings",
    label: "Pea",
    icon: Settings2,
    description:
      "The OpenAI-compatible endpoint Pea talks to — proved with a model list and one chat before it is saved.",
  },
  {
    to: "/design-system",
    title: "Design System",
    label: "Design language",
    icon: Palette,
    description:
      "The spec and catalogue for the design language — production components under production tokens, with the gaps they cannot yet express marked in place.",
    satellites: [
      { to: "/design-system/band", label: "band" },
      { to: "/design-system/list", label: "list" },
      { to: "/design-system/arming", label: "arming" },
      { to: "/design-system/popovers", label: "popovers" },
      { to: "/design-system/swatch", label: "swatch" },
    ],
  },
] as const;

function App() {
  return (
    <div className="min-h-screen px-6">
      <header className="py-4">
        <RouteShell manifest={manifest} name="Positive Energy" />
      </header>

      <main className="py-16">
        <section className="max-w-2xl">
          <p className="t-small t-upper mb-3 text-ink-2">
            <span className="t-upper">Internal tools</span> ·{" "}
            <span className="t-small face-mono">update proof 0.6.22</span>
          </p>
          <p className="t-display face-display text-ink">Healthy people, healthy planet.</p>
          <p className="t-prose mt-4 text-ink-2">
            A small workbench of internal tools — the Pea agent, Revit data, and the host pipeline.
            Pick one to get started.
          </p>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <div key={tool.to} className="flex flex-col gap-1.5 [&>[data-slot=card]]:flex-1">
              <Card render={<Link to={tool.to} />}>
                <div className="flex items-center justify-between">
                  <span className="inline-flex size-9 items-center justify-center">
                    <tool.icon className="size-4.5" />
                  </span>
                  <ArrowUpRight className="size-4 text-ink-2" />
                </div>
                <div>
                  <p className="t-small t-upper">{tool.label}</p>
                  <h2 className="t-title mt-0.5 text-ink">{tool.title}</h2>
                  <p className="t-prose mt-1.5 text-ink-2">{tool.description}</p>
                </div>
              </Card>
              {"satellites" in tool && (
                <p className="t-small face-mono flex flex-wrap gap-x-2 px-1 text-ink-2">
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
