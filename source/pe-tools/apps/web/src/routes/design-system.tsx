import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GitFork,
  Paperclip,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { ModeDial } from "#/components/mode-dial";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "#/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { PickList } from "#/components/ui/pick-list";
import { SidePane } from "#/components/ui/side-pane";
import { ValueDiff } from "#/components/ui/value-diff";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { Tooltip, UiTooltipProvider } from "#/components/ui/tooltip";
import { GroundedDocView } from "#/grounded-doc/GroundedDocView";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { SAMPLE_DOC } from "#/grounded-doc/sample";
import type { Mode } from "#/workbench/depth";
import { PROSE_CLASS } from "#/workbench/prose";
import "#/workbench/lens.css";

export const Route = createFileRoute("/design-system")({ component: DesignSystem });

/* ────────────────────────────────────────────────────────────────────────────
   LIVING SPEC — the drafting-table instrumentation language.

   This route IS the reference for the visual language, kept in step with it.
   The page runs under the `.ds-canon` scope: box-shadows suppressed in-tree and
   `--border` re-pointed at `--line-2`, so every in-tree surface is a foreground-
   alpha hairline that flips with the theme for free (the Hairline treatment that
   won poc.surfaces). Portaled overlays (dialog/menu/select/tooltip) render at
   <body>, out of scope — their own ring is intentional elevation off the page.
   ──────────────────────────────────────────────────────────────────────────── */
const CANON_CSS = `
.ds-canon { --border: var(--line-2); }
.ds-canon [class*="shadow"] { box-shadow: none !important; }
.ds-canon [data-slot="button"] { border-color: var(--line-2); }
`;

/* Semantic tokens, each with the ROLE it plays in the language. */
const SEMANTIC: readonly [string, string, string][] = [
  ["background", "bg-background", "warm paper ground"],
  ["foreground", "bg-foreground", "Basalt ink"],
  ["card", "bg-card", "lifted panel surface"],
  ["primary", "bg-primary", "PE Blue — the one action peak"],
  ["secondary", "bg-secondary", "Mist — quiet fill"],
  ["muted", "bg-muted", "soft paper fill"],
  ["accent", "bg-accent", "PE Green wash — success/provenance"],
  ["destructive", "bg-destructive", "error only"],
  ["border", "bg-border", "hairline"],
];

/* Categorical data palette (--cat-*) with the MEANING each hue carries, not its name. */
const CAT: readonly { v: BadgeTone; means: string }[] = [
  { v: "blue", means: "built-in · family kind" },
  { v: "green", means: "value · proj+shared · success" },
  { v: "slate", means: "instance · neutral data" },
  { v: "lichen", means: "shared · formula" },
  { v: "clay", means: "project · warning" },
  { v: "kiln", means: "type · not-available · muted" },
];

type BadgeTone = "blue" | "green" | "slate" | "lichen" | "clay" | "kiln";

const MODELS = [
  { id: "opus", name: "Claude Opus 4.8", hint: "anthropic" },
  { id: "sonnet", name: "Claude Sonnet 4.6", hint: "anthropic" },
  { id: "haiku", name: "Claude Haiku 4.5", hint: "anthropic" },
];
const ACCESS = [
  { id: "read", name: "Read-only", hint: "Inspect host state, no writes" },
  { id: "write", name: "Read/Write", hint: "Mutate Revit documents" },
];
const FRAMEWORKS = ["Revit", "AutoCAD", "Rhino", "Grasshopper", "Navisworks", "Forma"];

/* Mock telemetry — a tool-call trace set reused across the patterns section. */
interface Trace {
  ts: string;
  title: string;
  dur: number;
  status: "OK" | "CACHE" | "ERR" | "RUN";
  id: string;
}
const TRACES: Trace[] = [
  {
    ts: "14:02:11.204",
    title: "Read family parameters for FA-Door-Single",
    dur: 142,
    status: "OK",
    id: "trc_8f2a",
  },
  {
    ts: "14:02:11.361",
    title: "Query all instances in active view",
    dur: 88,
    status: "CACHE",
    id: "trc_8f2b",
  },
  {
    ts: "14:02:12.009",
    title: "List available family types (built-in)",
    dur: 431,
    status: "OK",
    id: "trc_8f2c",
  },
  {
    ts: "14:02:12.550",
    title: "Run bounding-box collision pass",
    dur: 1204,
    status: "RUN",
    id: "trc_8f2d",
  },
  {
    ts: "14:02:13.812",
    title: "Set Mark on 42 selected instances",
    dur: 366,
    status: "ERR",
    id: "trc_8f2e",
  },
  {
    ts: "14:02:17.104",
    title: "Place 3 instances at grid intersections",
    dur: 540,
    status: "OK",
    id: "trc_8f30",
  },
];
const STATUS_HUE: Record<Trace["status"], string> = {
  OK: "var(--cat-green)",
  CACHE: "var(--cat-slate)",
  ERR: "var(--destructive)",
  RUN: "var(--cat-clay)",
};

/* Mock parameter rows for the dense hairline table. */
const PARAMS: readonly {
  name: string;
  value: string;
  tone: BadgeTone;
  kind: string;
  at: string;
}[] = [
  { name: "Wall Height", value: "3000 mm", tone: "slate", kind: "Instance", at: "4m ago" },
  { name: "Fire Rating", value: "2 hr", tone: "kiln", kind: "Type", at: "4m ago" },
  { name: "Assembly Code", value: "B2010.10", tone: "kiln", kind: "Type", at: "11m ago" },
  { name: "Structural Usage", value: "Bearing", tone: "slate", kind: "Instance", at: "11m ago" },
  { name: "Thermal Mass", value: "148.2 kJ/K", tone: "lichen", kind: "Calc", at: "1h ago" },
];

/* Mock stat panel (balanced budget) rows. */
type Status = "done" | "running" | "ready" | "stale" | "failed" | "queued";
const STAT_ROWS: { name: string; value: string; status: Status }[] = [
  { name: "wall-basic-200", value: "1,284", status: "done" },
  { name: "door-single-flush", value: "312", status: "running" },
  { name: "window-fixed", value: "97", status: "ready" },
  { name: "ceiling-compound", value: "44", status: "stale" },
  { name: "railing-guard", value: "8", status: "failed" },
];
const STATUS_TONE: Record<Status, BadgeTone> = {
  done: "green",
  running: "blue",
  ready: "slate",
  stale: "kiln",
  failed: "clay",
  queued: "lichen",
};

function DesignSystem() {
  return (
    <UiTooltipProvider>
      <div className="ds-canon min-h-screen">
        <style>{CANON_CSS}</style>
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
          <div className="page-wrap flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary" />
              <span className="font-pe-display text-sm font-semibold tracking-tight">
                Design System
              </span>
              <span className="tele-label ml-1 text-muted-foreground">living spec</span>
              <Link to="/" className="ml-2 text-xs text-muted-foreground">
                ← tools
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <main className="page-wrap flex flex-col gap-16 py-10">
          <Intro />
          <Laws />
          <Tokens />
          <Primitives />
          <Patterns />
          <GroundedDoc />
        </main>
      </div>
    </UiTooltipProvider>
  );
}

/* ── page-shell primitives ─────────────────────────────────────────────────── */

function Spec({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-border pb-2">
        <div className="flex items-baseline gap-3">
          <span className="tele-label text-muted-foreground">{String(n).padStart(2, "0")}</span>
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        </div>
        {note ? <p className="max-w-[72ch] text-[13px] text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A labelled sub-block. Children control their own layout via `wrap` (default flex-wrap row). */
function Group({
  label,
  children,
  wrap = "flex flex-wrap items-center gap-3",
}: {
  label: string;
  children: React.ReactNode;
  wrap?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="section-label">{label}</span>
      <div className={wrap}>{children}</div>
    </div>
  );
}

/* ── 00 · intro ─────────────────────────────────────────────────────────────── */

function Intro() {
  return (
    <section className="flex flex-col gap-3">
      <p className="font-pe-display text-3xl font-semibold tracking-tight">
        Drafting-table instrumentation.
      </p>
      <p className="max-w-[70ch] text-[14px] leading-relaxed text-muted-foreground">
        Two type families, hairline surfaces, one 2px edge, a tight density, and a color budget
        spent only where a hue carries meaning. Mono is reserved for values the machine measured;
        chrome stays in Open Sans. This page is the reference and is kept in step with the language
        — every primitive below is the real <code>ui/*</code> component, rendered under the same
        laws production runs under.
      </p>
    </section>
  );
}

/* ── 01 · laws ──────────────────────────────────────────────────────────────── */

function Law({
  name,
  children,
  example,
}: {
  name: string;
  children: React.ReactNode;
  example: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[128px_1fr] items-center gap-x-4 gap-y-2 border-b border-border py-3.5 last:border-b-0 sm:grid-cols-[128px_1fr_auto]">
      <span className="tele-label" style={{ color: "var(--cat-blue)" }}>
        {name}
      </span>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:justify-self-end">
        {example}
      </div>
    </div>
  );
}

function Laws() {
  return (
    <Spec
      n={1}
      title="Laws"
      note="Five rules that decide every surface. Each carries a live example rendered under the same tokens."
    >
      <div className="border-t border-border">
        <Law
          name="radius"
          example={
            <div
              className="grid size-10 place-items-center border border-border bg-muted"
              style={{ borderRadius: "var(--radius)" }}
            >
              <span className="tele text-muted-foreground">2px</span>
            </div>
          }
        >
          Edges are 2px, from <code>--radius</code>. Sharp instrument corners softened one notch off
          90°; data surfaces may drop to 0 locally. No pills, no rounded-2xl cards.
        </Law>

        <Law
          name="hairline"
          example={
            <div className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-border">
              <span className="border-b border-border bg-card px-3 py-1 text-[11px]">surface</span>
              <span className="bg-card px-3 py-1 text-[11px] text-muted-foreground">divider</span>
            </div>
          }
        >
          Surfaces are drawn with 1px <code>--line</code> / <code>--line-2</code> borders, never
          shadows. Hairlines are foreground-alpha, so they flip with the theme on their own.
        </Law>

        <Law
          name="mono = measured"
          example={
            <div className="flex items-baseline gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-1.5">
              <span className="text-[12px]">Duration</span>
              <span className="tele" style={{ color: "var(--cat-green)" }}>
                142ms
              </span>
            </div>
          }
        >
          Mono means the machine measured this — states, stats, counts, ids, timestamps in the{" "}
          <code>tele</code> tiers. Labels and prose stay sans; mono is never chrome.
        </Law>

        <Law
          name="density"
          example={
            <div className="w-44 rounded-[var(--radius)] border border-border bg-card">
              {["door-single", "window-fixed"].map((r) => (
                <div
                  key={r}
                  className="flex items-baseline justify-between border-b border-border px-2.5 py-1.5 last:border-b-0"
                >
                  <span className="text-[12px] font-medium">{r}</span>
                  <span className="tele-label text-muted-foreground">OK</span>
                </div>
              ))}
            </div>
          }
        >
          Rows breathe at <code>py-1.5</code> with a flat hierarchy — weight and position carry
          emphasis, size deltas stay ≤1px. Tight, scannable, no nesting theatre.
        </Law>

        <Law
          name="color budget"
          example={
            <div className="flex items-center gap-2">
              <Badge variant="green">done</Badge>
              <Badge variant="clay">warn</Badge>
              <Button size="sm">Run</Button>
            </div>
          }
        >
          Balanced: <code>cat-*</code> at /12 bg + /25 border + full-hue text, spent only where a
          hue means something (provenance, severity). Exactly one PE Blue action peak per view.
        </Law>
      </div>
    </Spec>
  );
}

/* ── 02 · tokens ────────────────────────────────────────────────────────────── */

function Tokens() {
  return (
    <Spec
      n={2}
      title="Tokens"
      note="Semantic colors and the categorical data palette (styles.css → @theme inline), plus the type tiers. Colors are labelled by the role/meaning they carry, not the hue name."
    >
      <Group label="Semantic — role" wrap="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {SEMANTIC.map(([name, bg, role]) => (
          <div key={name} className="flex items-center gap-2.5">
            <div className={`size-9 shrink-0 rounded-[var(--radius)] border border-border ${bg}`} />
            <div className="min-w-0">
              <div className="tele text-foreground">{name}</div>
              <div className="text-[11px] leading-tight text-muted-foreground">{role}</div>
            </div>
          </div>
        ))}
      </Group>

      <Group label="Data palette (--cat-*) — meaning" wrap="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CAT.map(({ v, means }) => (
          <div
            key={v}
            className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-1.5"
          >
            <Badge variant={v}>{v}</Badge>
            <span className="text-[12px] text-muted-foreground">{means}</span>
          </div>
        ))}
      </Group>

      <Group label="Provenance tints" wrap="flex flex-wrap gap-3">
        <div
          className="flex items-center gap-2 rounded-[var(--radius)] border px-3 py-1.5 text-[12px]"
          style={{ backgroundColor: "var(--user-tint)", borderColor: "var(--user-line)" }}
        >
          <GitFork size={13} className="opacity-50" />
          <span className="tele-label">you</span>
          <span className="text-muted-foreground">— --user (slate/kiln)</span>
        </div>
        <div
          className="flex items-center gap-2 rounded-[var(--radius)] border px-3 py-1.5 text-[12px]"
          style={{ backgroundColor: "var(--pea-tint)", borderColor: "var(--pea-line)" }}
        >
          <span className="tele-label" style={{ color: "var(--pe-green)" }}>
            pea
          </span>
          <span className="text-muted-foreground">— --pea (PE Green)</span>
        </div>
      </Group>

      <Group label="Type tiers" wrap="border-t border-border">
        <TypeSpecimen name=".display" spec="Spectral · page-title garnish only">
          <span className="font-pe-display text-[22px] font-semibold">Family reconciliation</span>
        </TypeSpecimen>
        <TypeSpecimen name=".body" spec="Open Sans · working prose / UI">
          <span className="text-[14px]">
            Two instances carry a type-driven Mark; both were skipped.
          </span>
        </TypeSpecimen>
        <TypeSpecimen name="section-label" spec="small-caps · tracked SANS · panel headers">
          <span className="section-label">Active worksets</span>
        </TypeSpecimen>
        <TypeSpecimen name="tele" spec="12px mono · tracked · measured values">
          <span className="tele">14:02:13.812 · 366ms · trc_8f2e</span>
        </TypeSpecimen>
        <TypeSpecimen name="tele-label" spec="11px mono · uppercase · states / statuses">
          <span className="tele-label">cache-read · reprocessed · readonly</span>
        </TypeSpecimen>
      </Group>
    </Spec>
  );
}

function TypeSpecimen({
  name,
  spec,
  children,
}: {
  name: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] items-baseline gap-4 border-b border-border py-3 last:border-b-0 sm:grid-cols-[130px_minmax(0,1.3fr)_minmax(0,1.4fr)]">
      <span className="tele" style={{ color: "var(--cat-blue)" }}>
        {name}
      </span>
      <span className="text-[12px] text-muted-foreground">{spec}</span>
      <span className="col-span-2 sm:col-span-1">{children}</span>
    </div>
  );
}

/* ── 03 · primitives ────────────────────────────────────────────────────────── */

function Primitives() {
  return (
    <Spec
      n={3}
      title="Primitives"
      note="The real ui/* components under the language. Everything clickable, every field, every overlay comes from exactly one of these."
    >
      <ButtonsBlock />
      <FieldsBlock />
      <BadgesBlock />
      <SurfacesBlock />
      <OverlaysBlock />
      <CommandBlock />
      <SidePaneBlock />
      <PickListBlock />
    </Spec>
  );
}

function ButtonsBlock() {
  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  return (
    <div className="flex flex-col gap-5">
      <Group label="Button — variants">
        {variants.map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
      </Group>
      <Group label="Button — sizes">
        {sizes.map((s) => (
          <Button key={s} size={s}>
            size {s}
          </Button>
        ))}
      </Group>
      <Group label="Button — icon · states · tooltip">
        <Button size="icon" aria-label="settings">
          <Settings2 />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label="copy">
          <Copy />
        </Button>
        <Button>
          <Sparkles /> with icon
        </Button>
        <Button disabled>disabled</Button>
        <Tooltip.Root>
          <Tooltip.Trigger render={<Button variant="outline">hover me</Button>} />
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={6}>
              <Tooltip.Popup className="rounded-[var(--radius)] bg-popover px-2 py-1 text-xs text-popover-foreground ring-1 ring-border">
                Tooltip via base-ui
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Group>
    </div>
  );
}

function FieldsBlock() {
  const [scope, setScope] = useState("all");
  const [on, setOn] = useState(true);
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-input">Input</Label>
        <Input id="ds-input" placeholder="Type something…" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-invalid">Input (invalid)</Label>
        <Input id="ds-invalid" aria-invalid defaultValue="bad value" />
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="ds-textarea">Textarea</Label>
        <Textarea id="ds-textarea" placeholder="Multi-line input…" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-ig">Input group (addon + inline button)</Label>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput id="ds-ig" placeholder="Search families…" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton>Clear</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div className="flex items-center gap-3 self-end">
        <Switch checked={on} onCheckedChange={setOn} id="ds-switch" />
        <Label htmlFor="ds-switch">Switch ({on ? "on" : "off"})</Label>
        <Switch size="sm" defaultChecked />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Select</Label>
        <Select value={scope} onValueChange={(v: string | null) => v && setScope(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All loaded</SelectItem>
            <SelectItem value="placed">Placed only</SelectItem>
            <SelectItem value="unplaced">Unplaced only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Combobox (searchable)</Label>
        <Combobox items={FRAMEWORKS}>
          <ComboboxInput placeholder="Search a host…" className="w-[240px]" />
          <ComboboxContent>
            <ComboboxEmpty>No matches</ComboboxEmpty>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    </div>
  );
}

function BadgesBlock() {
  return (
    <div className="flex flex-col gap-5">
      <Group label="Badge — semantic">
        <Badge>default</Badge>
        <Badge variant="secondary">secondary</Badge>
        <Badge variant="outline">outline</Badge>
        <Badge variant="destructive">destructive</Badge>
      </Group>
      <Group label="Badge — data palette (--cat-*)">
        {CAT.map(({ v }) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
      </Group>
    </div>
  );
}

function SurfacesBlock() {
  const [view, setView] = useState("clustered");
  return (
    <div className="flex flex-col gap-5">
      <Group label="ToggleGroup — segmented control">
        <ToggleGroup value={view} onValueChange={setView}>
          <ToggleGroupItem value="clustered">Clustered</ToggleGroupItem>
          <ToggleGroupItem value="alpha">Alphabetical</ToggleGroupItem>
          <ToggleGroupItem value="grouped">Grouped</ToggleGroupItem>
        </ToggleGroup>
      </Group>
      <Group label="Card — panel" wrap="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Selection</CardTitle>
              <CardDescription>3 walls · Level 2 · Curtain Wall</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm">
                <RefreshCw /> Refresh
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Header, description, action, and content on one hairline surface.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Confirm</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Body content sits here.</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
            <Button size="sm">Save</Button>
          </CardFooter>
        </Card>
      </Group>
    </div>
  );
}

function OverlaysBlock() {
  const [sort, setSort] = useState("recent");
  return (
    <Group label="Overlays — DropdownMenu · Dialog">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Sort: {sort} <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
            <DropdownMenuLabel>Order by</DropdownMenuLabel>
            <DropdownMenuRadioItem value="recent">Most recent</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Clear all</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog>
        <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>This can't be undone. Your draft will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <DialogClose render={<Button variant="destructive" />}>Discard</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Group>
  );
}

function CommandBlock() {
  return (
    <Group label="Command — searchable palette (inline)" wrap="block">
      <div className="max-w-md overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem>
                <RefreshCw /> Refresh host state
                <CommandShortcut>⌘R</CommandShortcut>
              </CommandItem>
              <CommandItem>
                <Sparkles /> Reconcile family types
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigate">
              <CommandItem>
                <ChevronRight /> Open family matrix
              </CommandItem>
              <CommandItem>
                <ChevronRight /> Open schedule grid
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </Group>
  );
}

function SidePaneBlock() {
  const [open, setOpen] = useState(true);
  return (
    <Group label="SidePane — flanking pane (inline demo frame)" wrap="block">
      <div className="flex h-64 overflow-hidden rounded-[var(--radius)] border border-border">
        <SidePane
          side="left"
          storageKey="ds.sidepane"
          open={open}
          onOpenChange={setOpen}
          defaultWidth={220}
          minWidth={180}
          header={<span className="text-sm font-semibold">Threads</span>}
        >
          <ul className="p-1.5">
            {[
              "Ductwork clash sweep",
              "Level 3 core walls",
              "Curtain wall mullions",
              "Slab edge audit",
            ].map((t, i) => (
              <li key={t}>
                <button
                  type="button"
                  data-active={i === 0}
                  className="w-full rounded-[var(--radius)] px-2.5 py-1.5 text-left hover:bg-[var(--paper-2)] data-[active=true]:bg-[var(--paper-2)]"
                >
                  <div className="truncate text-[13px] font-medium">{t}</div>
                  <div className="tele-label text-muted-foreground">{(i + 1) * 3}m ago</div>
                </button>
              </li>
            ))}
          </ul>
        </SidePane>
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            The pane owns its width (drag the inner edge) and persists it. Collapse it with the
            chevron and it stays a live rail instead of vanishing — the workbench's one flanking
            primitive. Toggle:
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen((v) => !v)}>
            {open ? "Collapse" : "Expand"} left
          </Button>
        </section>
      </div>
    </Group>
  );
}

function PickListBlock() {
  const [picked, setPicked] = useState("42");
  return (
    <Group label="PickList — choose one from many (rail body)" wrap="block">
      <div className="flex h-64 overflow-hidden rounded-[var(--radius)] border border-border">
        <div className="w-60 border-r border-border">
          <PickList
            items={[
              { id: "42", label: "Pump Schedule", group: "Mechanical Equipment", meta: 12 },
              { id: "43", label: "Fan Schedule", group: "Mechanical Equipment", meta: 8 },
              { id: "44", label: "Boiler Schedule", group: "Mechanical Equipment" },
              {
                id: "51",
                label: "Plumbing Fixture Schedule",
                group: "Plumbing Fixtures",
                meta: 31,
              },
              { id: "52", label: "Water Supply Fixture Units (WSFU)", group: "Plumbing Fixtures" },
              {
                id: "61",
                label: "Lighting Fixture Schedule",
                group: "Lighting Fixtures",
                meta: 24,
              },
            ]}
            activeId={picked}
            onPick={setPicked}
            placeholder="Filter schedules…"
            className="h-full"
          />
        </div>
        <section className="min-w-0 flex-1 p-5">
          <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
            Type to narrow, ↑/↓ to move, Enter picks (the top match if you haven't moved), Escape
            clears. The blue left edge marks the open item; groups are section labels. Pair with
            SidePane, which owns collapse and width — PickList draws no chrome of its own.
          </p>
          <p className="tele mt-3 text-muted-foreground">
            picked → <span className="text-foreground">{picked}</span>
          </p>
        </section>
      </div>
    </Group>
  );
}

/* ── 04 · patterns ──────────────────────────────────────────────────────────── */

function Patterns() {
  return (
    <Spec
      n={4}
      title="Patterns"
      note="Compositions the language keeps producing — assembled from the primitives above, not new components. Copy the markup, don't reach for a fresh abstraction."
    >
      <TelemetryRows />
      <HairlineTable />
      <TrichotomyStates />
      <StatusStrip />
      <BalancedStatPanel />
      <ChatSurfaces />
      <RejectedFootnote />
    </Spec>
  );
}

/** Hybrid telemetry row: sans title, mono metadata right-aligned, one row expands to a payload. */
function TelemetryRows() {
  const [expanded, setExpanded] = useState(false);
  const PAYLOAD = `{
  "tool": "revit.param_write",
  "param": "Mark",
  "error": { "code": "READONLY_PARAM", "detail": "type-driven on 2 instances" },
  "elapsed_ms": 366
}`;
  return (
    <Group label="Hybrid telemetry rows" wrap="block">
      <div className="max-w-2xl border-t border-border">
        {TRACES.map((t, i) => {
          const isExp = i === 4 && expanded;
          return (
            <div key={t.id} className="border-b border-border">
              <button
                type="button"
                onClick={() => i === 4 && setExpanded((v) => !v)}
                className="flex w-full items-baseline justify-between gap-3 py-1.5 text-left"
              >
                <div className="flex min-w-0 items-baseline gap-1.5">
                  {i === 4 &&
                    (isExp ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    ))}
                  <span className="truncate text-[13px]">{t.title}</span>
                </div>
                <div className="flex shrink-0 items-baseline gap-2.5">
                  <span className="tele-label" style={{ color: STATUS_HUE[t.status] }}>
                    {t.status}
                  </span>
                  <span className="tele text-muted-foreground tabular-nums">{t.dur}ms</span>
                </div>
              </button>
              {isExp && (
                <pre className="tele mb-1.5 overflow-x-auto rounded-[var(--radius)] border border-border bg-muted p-2 text-[11px] leading-relaxed">
                  {PAYLOAD}
                </pre>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        (row 5 is clickable → expands payload)
      </p>
    </Group>
  );
}

/** Dense hairline table: a Revit parameter inspector, cat-badge source column, mono values. */
function HairlineTable() {
  return (
    <Group label="Dense hairline table" wrap="block">
      <div
        className="grid max-w-2xl overflow-hidden rounded-[var(--radius)] border border-border bg-card text-sm"
        style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) auto auto" }}
      >
        {(["Parameter", "Value", "Source", "Read"] as const).map((h) => (
          <div
            key={h}
            className="tele-label border-b border-border bg-muted/60 px-3 py-1.5 text-muted-foreground last:text-right"
          >
            {h}
          </div>
        ))}
        {PARAMS.map((p) => (
          <div key={p.name} className="contents">
            <div className="border-b border-border px-3 py-1.5 text-foreground">{p.name}</div>
            <div className="tele border-b border-border px-3 py-1.5 text-foreground">{p.value}</div>
            <div className="flex items-center border-b border-border px-3 py-1.5">
              <Badge variant={p.tone}>{p.kind}</Badge>
            </div>
            <div className="tele border-b border-border px-3 py-1.5 text-right text-muted-foreground">
              {p.at}
            </div>
          </div>
        ))}
      </div>
    </Group>
  );
}

/** Trichotomy cell states: how a co-edited value looks in every stage of proposal → staged → pushed. */
function TrichotomyStates() {
  const states = [
    {
      label: "proposed (pea)",
      cell: <ValueDiff from="100 VA" to="150 VA" className="font-medium text-cat-clay" />,
      tint: "bg-cat-clay/12",
    },
    {
      label: "staged (you)",
      cell: <ValueDiff from="100 VA" to="150 VA" className="font-medium text-cat-green" />,
      tint: "bg-cat-green/12",
    },
    {
      label: "needs review",
      cell: <ValueDiff from="100 VA" to="150 VA" className="font-medium" />,
      tint: "bg-destructive/10",
    },
    {
      label: "blocked (read-only)",
      cell: <span className="tele text-muted-foreground">100 VA</span>,
      tint: "bg-muted/40",
    },
  ] as const;
  return (
    <Group label="Trichotomy cell states (ValueDiff)" wrap="block">
      <div className="flex max-w-2xl flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card sm:flex-row">
        {states.map((state, i) => (
          <div
            key={state.label}
            className={`flex-1 px-3 py-2 ${state.tint} ${i > 0 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}
          >
            <div>{state.cell}</div>
            <div className="tele-label mt-1 text-muted-foreground">{state.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        ValueDiff is the one way a change is written: struck current → proposed, all mono. Clay =
        pea proposed, green = human staged, destructive tint = staged but flagged, muted = the
        binding refuses writes.
      </p>
    </Group>
  );
}

/** Status strip: a single mono line of machine facts. */
function StatusStrip() {
  return (
    <Group label="Status strip" wrap="block">
      <div className="tele max-w-2xl rounded-[var(--radius)] border border-border bg-muted/40 px-3 py-1.5 text-muted-foreground">
        <span className="tele-label">read</span> 4m ago · 581 families · 1,048 types ·{" "}
        <span className="tele-label" style={{ color: "var(--cat-green)" }}>
          fresh
        </span>
      </div>
    </Group>
  );
}

/** Balanced-budget stat panel — adapted from poc.dial's winning "balanced" intensity. */
function BalancedStatPanel() {
  const stats = [
    { k: "elements", v: "1,901" },
    { k: "errors", v: "3" },
    { k: "duration", v: "4.2s" },
    { k: "fresh", v: "98%" },
  ];
  return (
    <Group label="Balanced-budget stat panel" wrap="block">
      <div className="max-w-2xl overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        {/* head */}
        <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
          <div>
            <div className="text-[13px] font-semibold">Family reconciliation</div>
            <div className="tele text-muted-foreground">→ family-types</div>
          </div>
          <span className="tele-label text-muted-foreground">balanced</span>
        </div>
        {/* stat strip — neutral figures (color only on badges + the one action) */}
        <div className="grid grid-cols-4 border-b border-border">
          {stats.map((s, i) => (
            <div
              key={s.k}
              className="px-3 py-2"
              style={{ borderLeft: i === 0 ? "none" : "1px solid var(--line-soft)" }}
            >
              <div className="tele text-[18px] leading-none text-foreground">{s.v}</div>
              <div className="tele-label mt-1 text-muted-foreground">{s.k}</div>
            </div>
          ))}
        </div>
        {/* rows — cat badge carries category, nothing else colored */}
        <div>
          {STAT_ROWS.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <span className="tele text-foreground">{r.name}</span>
              <div className="flex items-center gap-3">
                <span className="tele text-muted-foreground tabular-nums">{r.value}</span>
                <Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>
              </div>
            </div>
          ))}
        </div>
        {/* alert — one green success moment */}
        <div
          className="tele flex items-center gap-2 border-t border-border px-3 py-2"
          style={{
            color: "var(--cat-green)",
            background: "color-mix(in srgb, var(--cat-green) 8%, transparent)",
          }}
        >
          sync complete — 1 row needs review.
        </div>
        {/* actions — exactly one PE Blue peak */}
        <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="outline" size="sm">
            Cancel
          </Button>
          <Button size="sm">Run</Button>
        </div>
      </div>
    </Group>
  );
}

/* Chat surfaces: header controls (ModeDial + pickers), a real Lens render, and a hairline composer. */
function ChatSurfaces() {
  const [mode, setMode] = useState<Mode>("threads");
  return (
    <div className="flex flex-col gap-5">
      <Group label="Chat header controls">
        <ModeDial mode={mode} setMode={setMode} />
        <Picker title="Model" options={MODELS} initial="opus" />
        <Picker title="Access" options={ACCESS} initial="read" />
      </Group>

      <Group label="Live thread (real Lens render + provenance colors)" wrap="block">
        <LensThread />
      </Group>

      <Group label="Composer (hairline)" wrap="block">
        <ComposerMock />
      </Group>
    </div>
  );
}

/** A faithful slice of production chat: real .lens-frame, .lens-marker, and PROSE_CLASS. */
function LensThread() {
  return (
    <div className="lens-frame overflow-hidden rounded-[var(--radius)] border border-border">
      <div className="lens-chat">
        <div className="lens-moment" data-role="user">
          <div className="mb-1.5 inline-flex items-center gap-[7px] text-[10px] font-semibold tracking-[0.1em] text-[var(--pe-green)] uppercase">
            <span>you</span>
            <GitFork size={12} className="opacity-40" />
          </div>
          <div className="ml-auto w-fit max-w-[80%] rounded-[12px_12px_2px_12px] border-[0.5px] border-[var(--user-line)] bg-[var(--user-tint)] px-3 py-2 text-sm leading-normal">
            Can you list the loaded Revit families and their type counts?
          </div>
        </div>

        <div className="lens-moment" data-role="assistant">
          <div className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--pe-blue)] uppercase">
            pea
          </div>
          <div className="grid gap-2">
            <div className={PROSE_CLASS}>
              <h3>Loaded families</h3>
              <p>
                Here's what's loaded. I called <code>listLoadedFamilies</code> and grouped by{" "}
                <a href="#">category</a>:
              </p>
              <ul>
                <li>
                  <strong>Doors</strong> — 12 types
                </li>
                <li>
                  <strong>Windows</strong> — 8 types
                </li>
              </ul>
              <blockquote>Tip: pass a scope to filter to placed instances only.</blockquote>
            </div>
            <div className="lens-marker tool">
              <span>⌗ listLoadedFamilies</span>
              <code>scope=all</code>
            </div>
            <div className="lens-marker tool active">
              <span>⌗ readFamilyTypes</span>
              <code>category=Doors</code>
            </div>
            <div className="lens-marker tool failed">
              <span>⌗ resolveSymbol</span>
              <code>id=4821</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Model/access picker — DropdownMenu radio group behind a Button trigger (canonical). */
function Picker({
  title,
  options,
  initial,
}: {
  title: string;
  options: { id: string; name: string; hint?: string }[];
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const label = options.find((o) => o.id === value)?.name ?? title;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} title={title}>
        {label} <ChevronDown className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={setValue}>
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.id} value={o.id} className="flex-col items-start">
              <span className="text-foreground">{o.name}</span>
              {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComposerMock() {
  return (
    <div className="relative w-full max-w-2xl rounded-[var(--radius)] border border-border bg-card">
      <div className="flex items-end gap-1 p-2">
        <Button type="button" variant="ghost" size="icon" title="Attach files">
          <Paperclip />
        </Button>
        <Textarea
          placeholder="Ask Pea…  ( / for commands )"
          rows={1}
          className="max-h-48 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button type="button" size="icon" title="Send">
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}

/** One instructive footnote: the two treatments the language explicitly rejects. */
function RejectedFootnote() {
  return (
    <Group label="Rejected — kept as a warning" wrap="flex flex-wrap items-center gap-6">
      <div className="flex flex-col items-start gap-1.5">
        <div className="rounded-2xl bg-card px-4 py-2.5 text-[12px] shadow-lg shadow-black/15">
          elevated card
        </div>
        <span className="tele-label" style={{ color: "var(--destructive)" }}>
          rejected · shadow + rounded-2xl
        </span>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <span
          className="rounded-full border px-3 py-1 text-[12px]"
          style={{ borderColor: "var(--cat-blue)", color: "var(--cat-blue)" }}
        >
          pill chip
        </span>
        <span className="tele-label" style={{ color: "var(--destructive)" }}>
          rejected · fully-round pill
        </span>
      </div>
      <p className="max-w-[38ch] text-[12px] text-muted-foreground">
        Elevation and pills read as consumer-app chrome. The language draws structure with hairlines
        and a 2px edge instead — badges are square-ish, surfaces are bordered, never floated.
      </p>
    </Group>
  );
}

/* ── composed showcase: GroundedDocView over useGroundedDoc() ─────────────────── */

function GroundedDoc() {
  const engine = useGroundedDoc();
  useEffect(() => {
    if (!engine.doc) engine.setDoc(SAMPLE_DOC);
  }, [engine]);

  return (
    <Spec
      n={5}
      title="Grounded document"
      note="Reusable <GroundedDocView> over useGroundedDoc() — hover a markdown block or a page box to link the two. Drop it anywhere a parsed PDF needs to stay traceable. Full harness at /doc-lab."
    >
      <div className="h-[520px] overflow-hidden rounded-[var(--radius)] border border-border">
        <GroundedDocView engine={engine} className="h-full" />
      </div>
    </Spec>
  );
}
