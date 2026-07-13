import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";

export const Route = createFileRoute("/poc/surfaces")({ component: PocSurfaces });

/* ── scoped variant CSS ──────────────────────────────────────────────────────
   Every override lives here, scoped under a wrapper class. styles.css and the
   ui/* primitives are never touched — the specimen markup is identical across
   variants; only the token scope around it changes.

   Levers used:
   - `--border` re-pointed at `--line-2` → every bordered primitive (Card, Input,
     Switch, buttons) becomes a foreground-alpha hairline that flips for free.
   - `[class*="shadow"]` box-shadow suppression → kills shadcn elevation in-tree.
     (Portaled popovers render at <body> and are out of scope; irrelevant to a
     static screenshot where menus are closed.)
   - radius-* tokens zeroed for Compartment → shadcn utilities read them at use.
   - `.spec-grid` gap trick → parent painted `--line-2`, cells painted `--card`,
     so the 1px gaps ARE the compartment borders.
   No new hex values: every color resolves to an existing token. */
const VARIANT_CSS = `
/* ---- Hairline + Compartment share the flat, borders-not-shadows base ---- */
.poc-hairline, .poc-compartment {
  --border: var(--line-2);
}
.poc-hairline [class*="shadow"],
.poc-compartment [class*="shadow"] {
  box-shadow: none !important;
}
/* Flat buttons: give every button a hairline edge (default/primary has none),
   so structure is drawn by lines, not fills or elevation. Hover stays a one-step
   bg shift (already token-driven in the Button variants). */
.poc-hairline [data-slot="button"],
.poc-compartment [data-slot="button"] {
  border-color: var(--line-2);
}

/* ---- Data surface: grid of cells, row-hairline by default ---- */
.spec-grid { display: grid; }
.spec-grid > .spec-cell { border-bottom: 1px solid var(--line); }
.spec-grid > .spec-cell:nth-last-child(-n + 4) { border-bottom: 0; }

/* ---- Compartment: radius 0 in data + the gap-is-the-border trick ---- */
.poc-compartment {
  --radius: 0px;
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
}
.poc-compartment .spec-grid {
  gap: 1px;
  background: var(--line-2);
  border: 1px solid var(--line-2);
}
.poc-compartment .spec-grid > .spec-cell {
  border-bottom: 0;
  background: var(--card);
}
`;

type VariantKey = "current" | "hairline" | "compartment";

const VARIANTS: { key: VariantKey; cls: string; name: string; intent: string }[] = [
  {
    key: "current",
    cls: "poc-current",
    name: "Current",
    intent: "Baseline — shadcn defaults: soft shadows, tinted borders, 2px radius.",
  },
  {
    key: "hairline",
    cls: "poc-hairline",
    name: "Hairline",
    intent: "Shadows removed; every surface a 1px --line-2 hairline. Flat, calm, honest.",
  },
  {
    key: "compartment",
    cls: "poc-compartment",
    name: "Compartment",
    intent: "Hairline plus the grid-gap trick — the 1px gaps ARE the borders; radius 0 in data.",
  },
];

/* Mock data — a Revit parameter inspector row set. */
const PARAMS = [
  { name: "Wall Height", value: "3000 mm", tone: "blue", kind: "Instance", at: "4m ago" },
  { name: "Fire Rating", value: "2 hr", tone: "clay", kind: "Type", at: "4m ago" },
  { name: "Assembly Code", value: "B2010.10", tone: "slate", kind: "Type", at: "11m ago" },
  { name: "Structural Usage", value: "Bearing", tone: "green", kind: "Instance", at: "11m ago" },
  { name: "Thermal Mass", value: "148.2 kJ/K", tone: "lichen", kind: "Calc", at: "1h ago" },
  { name: "Phase Created", value: "New Constr.", tone: "kiln", kind: "Instance", at: "1h ago" },
] as const;

const CATS = ["blue", "green", "slate", "lichen", "clay", "kiln"] as const;

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-pe-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

function PocSurfaces() {
  const [active, setActive] = useState<VariantKey>("hairline");
  const [scope, setScope] = useState("placed");
  const [live, setLive] = useState(true);
  const variant = VARIANTS.find((v) => v.key === active) ?? VARIANTS[0];

  return (
    <div className="min-h-screen">
      <style>{VARIANT_CSS}</style>

      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="page-wrap flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" />
            <span className="font-pe-display text-sm font-semibold tracking-tight">
              Surface Treatments
            </span>
            <Link to="/design-system" className="ml-2 text-xs text-muted-foreground">
              ← design system
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-wrap flex flex-col gap-6 py-8">
        {/* variant switcher — plain buttons */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {VARIANTS.map((v) => {
              const on = v.key === active;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setActive(v.key)}
                  className={`rounded-sm border px-3 py-1.5 font-pe-mono text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {v.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{variant.name}</span> — {variant.intent}
          </p>
        </div>

        {/* the specimen board, rendered under the active variant scope */}
        <div className={variant.cls}>
          <SpecimenBoard scope={scope} setScope={setScope} live={live} setLive={setLive} />
        </div>
      </main>
    </div>
  );
}

function SpecimenBoard({
  scope,
  setScope,
  live,
  setLive,
}: {
  scope: string;
  setScope: (v: string) => void;
  live: boolean;
  setLive: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* toolbar */}
      <section className="flex flex-col gap-2">
        <Lbl>Toolbar</Lbl>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Apply</Button>
          <Button variant="outline">Preview</Button>
          <Button variant="ghost">Reset</Button>
          <Select value={scope} onValueChange={(v: string | null) => v && setScope(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All loaded</SelectItem>
              <SelectItem value="placed">Placed only</SelectItem>
              <SelectItem value="unplaced">Unplaced only</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 pl-1">
            <Switch checked={live} onCheckedChange={setLive} id="poc-live" />
            <Label htmlFor="poc-live" className="text-xs">
              Live
            </Label>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* card */}
        <section className="flex flex-col gap-2">
          <Lbl>Panel (Card)</Lbl>
          <Card>
            <CardHeader>
              <div className="space-y-1">
                <CardTitle>Selection</CardTitle>
                <CardDescription>3 walls · Level 2 · Curtain Wall</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                <RefreshCw /> Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Header, content, and footer on one bordered surface. Judge how the panel edge reads
                against the paper ground — shadow lift vs. drawn hairline.
              </p>
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
              <Button size="sm">Save</Button>
            </CardFooter>
          </Card>
        </section>

        {/* form group */}
        <section className="flex flex-col gap-2">
          <Lbl>Form group</Lbl>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="poc-name">Type name</Label>
              <Input id="poc-name" defaultValue="EXT — Brick Cavity 300" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="poc-note">Note</Label>
              <Textarea
                id="poc-note"
                rows={2}
                placeholder="Describe the assembly change…"
                defaultValue="Swapped insulation core; U-value recomputed."
              />
            </div>
          </div>
        </section>
      </div>

      {/* data table — the grid-gap specimen */}
      <section className="flex flex-col gap-2">
        <Lbl>Parameter table</Lbl>
        <div
          className="spec-grid rounded-lg bg-card text-sm shadow-sm"
          style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) auto auto" }}
        >
          {(["Parameter", "Value", "Source", "Read"] as const).map((h) => (
            <div
              key={h}
              className="spec-cell bg-muted/60 px-3 py-1.5 font-pe-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground last:text-right"
            >
              {h}
            </div>
          ))}
          {PARAMS.map((p) => (
            <FragmentRow key={p.name} p={p} />
          ))}
        </div>
      </section>

      {/* badges */}
      <section className="flex flex-col gap-2">
        <Lbl>Category badges (--cat-*)</Lbl>
        <div className="flex flex-wrap items-center gap-2">
          {CATS.map((c) => (
            <Badge key={c} variant={c}>
              {c}
            </Badge>
          ))}
        </div>
      </section>

      {/* status strip */}
      <section className="flex flex-col gap-2">
        <Lbl>Status strip</Lbl>
        <div className="rounded-sm border border-border bg-muted/40 px-3 py-1.5 font-pe-mono text-[0.7rem] tracking-[0.08em] text-muted-foreground">
          READ 4M AGO · 581 FAMILIES · 1,048 TYPES
        </div>
      </section>
    </div>
  );
}

function FragmentRow({ p }: { p: (typeof PARAMS)[number] }) {
  return (
    <>
      <div className="spec-cell px-3 py-1.5 text-foreground">{p.name}</div>
      <div className="spec-cell px-3 py-1.5 font-pe-mono text-xs text-foreground">{p.value}</div>
      <div className="spec-cell flex items-center px-3 py-1.5">
        <Badge variant={p.tone}>{p.kind}</Badge>
      </div>
      <div className="spec-cell px-3 py-1.5 text-right font-pe-mono text-xs text-muted-foreground">
        {p.at}
      </div>
    </>
  );
}
