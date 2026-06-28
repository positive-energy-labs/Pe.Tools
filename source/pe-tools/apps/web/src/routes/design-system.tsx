import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUp, ChevronDown, Copy, GitFork, Paperclip, Settings2, Sparkles } from "lucide-react";

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
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { Tooltip, UiTooltipProvider } from "#/components/ui/tooltip";
import type { Mode } from "#/workbench/depth";
import { PROSE_CLASS } from "#/workbench/prose";
import "#/workbench/lens.css";

export const Route = createFileRoute("/design-system")({ component: DesignSystem });

// Semantic tokens, each backed by a Tailwind color utility from @theme inline (styles.css).
const SEMANTIC = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["primary", "bg-primary"],
  ["secondary", "bg-secondary"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["destructive", "bg-destructive"],
  ["border", "bg-border"],
] as const;

// Categorical data palette (--cat-*) — used raw via var(); not in the Tailwind theme.
const CAT = ["blue", "green", "slate", "lichen", "clay", "kiln"] as const;

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

function DesignSystem() {
  return (
    <UiTooltipProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
          <div className="page-wrap flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary" />
              <span className="text-sm font-semibold tracking-tight">Design System</span>
              <Link to="/" className="ml-2 text-xs text-muted-foreground">
                ← tools
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <main className="page-wrap flex flex-col gap-12 py-10">
          <Colors />
          <Typography />
          <Buttons />
          <FormControls />
          <Surfaces />
          <Overlays />
          <ChatRegister />
        </main>
      </div>
    </UiTooltipProvider>
  );
}

/* ── primitives for the page itself ────────────────────────────────────── */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="border-b border-border pb-2">
        <h2 className="font-pe-display text-2xl font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ── sections ──────────────────────────────────────────────────────────── */

function Colors() {
  return (
    <Section
      title="Color"
      hint="Semantic tokens (styles.css → @theme inline) and the categorical data palette."
    >
      <Row label="Semantic">
        {SEMANTIC.map(([name, bg]) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className={`size-14 rounded-lg ring-1 ring-foreground/15 ring-inset ${bg}`} />
            <span className="text-[0.65rem] text-muted-foreground">{name}</span>
          </div>
        ))}
      </Row>

      <Row label="Data palette (Badge tones, --cat-*)">
        {CAT.map((c) => (
          <Badge key={c} variant={c}>
            cat-{c}
          </Badge>
        ))}
      </Row>

      <Row label="Provenance tints">
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ backgroundColor: "var(--user-tint)", borderColor: "var(--user-line)" }}
        >
          user-tint / user-line (you)
        </div>
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ backgroundColor: "var(--pea-tint)", borderColor: "var(--pea-line)" }}
        >
          pea-tint / pea-line (assistant)
        </div>
      </Row>

      <Row label="Radii">
        {(["sm", "md", "lg", "xl"] as const).map((r) => (
          <div key={r} className="flex flex-col items-center gap-1">
            <div className={`size-12 border border-border bg-muted rounded-${r}`} />
            <span className="text-[0.65rem] text-muted-foreground">rounded-{r}</span>
          </div>
        ))}
      </Row>
    </Section>
  );
}

function Typography() {
  return (
    <Section
      title="Typography"
      hint="Open Sans (font-sans/font-pe) for UI, Spectral (font-pe-display) for display, mono for code."
    >
      <p className="font-pe-display text-4xl font-semibold tracking-tight">
        Healthy people, healthy planet.
      </p>
      <p className="font-pe-display text-2xl font-semibold">Display heading — Spectral</p>
      <h3 className="text-lg font-semibold">Section heading — Open Sans semibold</h3>
      <p className="text-sm leading-7 text-foreground">
        Body text in Open Sans. The quick brown fox jumps over the lazy dog while a workbench of
        internal tools hums along quietly in the background.
      </p>
      <p className="text-xs leading-6 text-muted-foreground">
        Muted caption / secondary text — text-xs text-muted-foreground.
      </p>
      <p className="font-pe-mono text-xs">const mono = "ui-monospace — font-pe-mono";</p>
    </Section>
  );
}

function Buttons() {
  const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
  const sizes = ["xs", "sm", "default", "lg"] as const;
  return (
    <Section
      title="Buttons"
      hint="One Button, CVA variants × sizes. Everything clickable should come from here."
    >
      <Row label="Variants">
        {variants.map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
      </Row>
      <Row label="Sizes">
        {sizes.map((s) => (
          <Button key={s} size={s}>
            size {s}
          </Button>
        ))}
      </Row>
      <Row label="Icon + states">
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
              <Tooltip.Popup className="rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
                Tooltip via base-ui
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Row>
    </Section>
  );
}

function FormControls() {
  const [scope, setScope] = useState("all");
  const [on, setOn] = useState(true);
  return (
    <Section
      title="Form controls"
      hint="Input, Textarea, Switch, Select, Combobox — the canonical field kit."
    >
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

        <div className="flex items-center gap-3">
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

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>Combobox (searchable)</Label>
          <Combobox items={FRAMEWORKS}>
            <ComboboxInput placeholder="Search a host…" className="w-[260px]" />
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
    </Section>
  );
}

function Surfaces() {
  const [view, setView] = useState("clustered");
  return (
    <Section
      title="Surfaces & toggles"
      hint="Card and ToggleGroup — the canonical panel + segmented control."
    >
      <Row label="Toggle group">
        <ToggleGroup value={view} onValueChange={setView}>
          <ToggleGroupItem value="clustered">Clustered</ToggleGroupItem>
          <ToggleGroupItem value="alpha">Alphabetical</ToggleGroupItem>
          <ToggleGroupItem value="grouped">Grouped</ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Selection</CardTitle>
              <CardDescription>Workspace → module → root → file.</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm">
                Refresh
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Card with header, description, action, and content.
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
      </div>
    </Section>
  );
}

function Overlays() {
  const [sort, setSort] = useState("recent");
  return (
    <Section title="Overlays" hint="DropdownMenu and Dialog — the canonical menu + modal.">
      <Row label="Dropdown menu">
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
      </Row>

      <Row label="Dialog">
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
      </Row>
    </Section>
  );
}

/* ── chat register: design-dependent chat surfaces, mocked ─────────────── */

function ChatRegister() {
  const [mode, setMode] = useState<Mode>("chat");
  return (
    <Section
      title="Chat register"
      hint="Design-dependent chat surfaces. The thread is a real .lens-frame using the same Lens palette + prose as production — it flips with the theme on its own."
    >
      <Row label="Header controls">
        <ModeDial mode={mode} setMode={setMode} />
        <Picker title="Model" options={MODELS} initial="opus" />
        <Picker title="Access" options={ACCESS} initial="read" />
      </Row>

      <Row label="Status chips (Badge)">
        <Badge variant="green">connected</Badge>
        <Badge variant="blue">built-in</Badge>
        <Badge variant="clay">warning</Badge>
        <Badge variant="slate">instance</Badge>
        <Badge>running</Badge>
      </Row>

      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          Live thread (real Lens render)
        </span>
        <LensThread />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          Composer
        </span>
        <ComposerMock />
      </div>
    </Section>
  );
}

/** A faithful slice of the production chat: real .lens-frame, .lens-marker, and PROSE_CLASS. */
function LensThread() {
  return (
    <div className="lens-frame overflow-hidden rounded-xl border border-border">
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
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Types</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Doors</td>
                    <td>12</td>
                  </tr>
                  <tr>
                    <td>Windows</td>
                    <td>8</td>
                  </tr>
                </tbody>
              </table>
              <pre>
                <code>{`{ "category": "Doors", "types": 12 }`}</code>
              </pre>
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
    <div className="relative w-full rounded-2xl border border-border bg-card/95 shadow-lg shadow-black/5">
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
