import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@pe/kit/lang/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from "@pe/kit/lang/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@pe/kit/lang/hover-card";
import { ThemeToggle } from "@pe/kit/lang/theme-toggle";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { FieldOptionPicker, FieldOptionSelect, type FieldOption } from "#/host/field-options";
import { CATEGORY_OPTIONS } from "#/design-system/specimens-data";
import type {
  HostActiveDocumentSummary,
  HostResourceFileStateData,
} from "@pe/host-contracts/operation-types";
import type { PodRouteDescriptor, PagePublication } from "@pe/host-contracts/pe-api";
import type { Reading } from "@pe/agent-contracts";

export const Route = createFileRoute("/design-system_/popovers")({ component: PopoverHarness });

// Contract-shaped fixtures, never current host observations or executable resources.
const documentSnapshot = {
  title: "North wing · Mechanical",
  key: "fixture-document",
  path: "Models/North wing.rvt",
  isFamilyDocument: false,
  isModelInCloud: false,
  isWorkshared: true,
  observedAtUnixMs: Date.parse("2026-10-14T14:30:00Z"),
} satisfies HostActiveDocumentSummary;
const file = {
  exists: true,
  label: "Shared parameters",
  path: "Standards/Shared Parameters.txt",
  provenance: "Saved file observation",
  sizeBytes: 18432,
  lastWriteTimeUnixMs: Date.parse("2026-10-13T16:00:00Z"),
} satisfies HostResourceFileStateData;
const reading = {
  state: "stale",
  previous: file,
  reason: "disconnected",
} satisfies Reading<HostResourceFileStateData>;
const page = {
  kind: "page",
  slug: "air-balance",
  title: "Air balance review",
  html: "<h1>Air balance review</h1><p>Supply and return observations by room.</p>",
} satisfies PagePublication;
const pod = {
  key: "route:@mechanical/routes/air-balance",
  packageId: "mechanical",
  sourcePath: "routes/air-balance/index.js",
  name: "Air balance",
  description: "Compare supply and return observations by room.",
  page: "pages/air-balance",
  workRoute: "air-balance",
  sha256: "a".repeat(64),
  trusted: false,
} satisfies PodRouteDescriptor;
const MOTIFS = [
  {
    id: "A",
    name: "Identity strip",
    label: documentSnapshot.title,
    kind: "Document",
    value: documentSnapshot,
  },
  { id: "B", name: "Observation ledger", label: file.label, kind: "Reading", value: reading },
  { id: "C", name: "Content excerpt", label: page.title, kind: "Page", value: page },
  { id: "D", name: "Capability receipt", label: pod.name, kind: "Pod route", value: pod },
] as const;
type Motif = (typeof MOTIFS)[number];

function ResourcePreview({ motif, inspect }: { motif: Motif; inspect: () => void }) {
  return (
    <div data-motif={motif.id} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <PopoverTitle>{motif.label}</PopoverTitle>
        <span className="text-ink-2">{motif.kind} · fixture</span>
      </div>
      {motif.id === "A" ? (
        <>
          <p>Workshared project · saved observation</p>
          <p className="face-mono break-all">{documentSnapshot.path}</p>
          <p className="text-ink-2">Observed 14 Oct, 14:30 UTC. Current availability unknown.</p>
        </>
      ) : motif.id === "B" ? (
        <>
          <p data-tone="caution">Stale · host disconnected</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>Source</dt>
            <dd className="face-mono break-all">{file.path}</dd>
            <dt>Last size</dt>
            <dd className="face-mono">18 KiB</dd>
            <dt>Modified</dt>
            <dd className="face-mono">13 Oct, 16:00 UTC</dd>
          </dl>
          <p className="text-ink-2">Last known file exists. Reconnect before relying on it.</p>
        </>
      ) : motif.id === "C" ? (
        <>
          <div data-surface="document" className="space-y-2 p-3">
            <p>{page.title}</p>
            <p>Supply and return observations by room.</p>
          </div>
          <p className="text-ink-2">
            Authored Page · no executable route. Excerpt of fixture content.
          </p>
        </>
      ) : (
        <>
          <p>{pod.description}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>Package</dt>
            <dd className="face-mono">{pod.packageId}</dd>
            <dt>Entry</dt>
            <dd className="face-mono break-all">{pod.sourcePath}</dd>
            <dt>Trust</dt>
            <dd data-tone="caution">Not trusted · cannot run</dd>
          </dl>
          <p className="text-ink-2">A promoted executable route has a separate trust boundary.</p>
        </>
      )}
      <div className="hairline-t pt-2">
        <PopoverClose
          render={
            <Button label={`Inspect ${motif.id} snapshot`} onClick={inspect}>
              Inspect snapshot
            </Button>
          }
        />
      </div>
    </div>
  );
}

function HintSpecimen() {
  return (
    <Tooltip>
      <TooltipTrigger aria-label="Hint specimen">Hint</TooltipTrigger>
      <TooltipContent>Read the last saved observation.</TooltipContent>
    </Tooltip>
  );
}
function ClickSpecimen() {
  const [checked, setChecked] = useState(false);
  return (
    <Popover>
      <PopoverTrigger>Click details</PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Observation options</PopoverTitle>
        <PopoverDescription>Interactive content stays open while you work.</PopoverDescription>
        <Button label="Include archived" pressed={checked} onClick={() => setChecked(!checked)}>
          Archived: {checked ? "included" : "hidden"}
        </Button>
        <PopoverClose render={<Button label="Close details">Close</Button>} />
      </PopoverContent>
    </Popover>
  );
}
function HoverSpecimen() {
  return (
    <HoverCard>
      <HoverCardTrigger>Hover preview</HoverCardTrigger>
      <HoverCardContent aria-label="Preview specimen">
        <p>Hover holds this preview. Click or Enter exposes the same controls.</p>
        <PopoverClose render={<Button label="Close preview">Close</Button>} />
      </HoverCardContent>
    </HoverCard>
  );
}
const FIELD_OPTIONS: FieldOption[] = CATEGORY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  description: o.description ?? null,
}));
type Choice = { value: string; label: string; description?: string };
const CHOICES: Choice[] = CATEGORY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  description: o.description ?? undefined,
}));
function FacetFilterSpecimen() {
  const [value, setValue] = useState("");
  const choices = [{ value: "", label: "any" }, ...CHOICES];
  return (
    <ListPopup<Choice>
      anchor="trigger"
      face="fill"
      triggerLabel="category filter"
      trigger={choices.find((c) => c.value === value)?.label}
      aria-label="category values"
      items={choices}
      keyOf={(c) => c.value}
      labelOf={(c) => c.label}
      filter="substring"
      searchAbove={8}
      select="single"
      selected={[value]}
      empty="no values"
      onPick={(c) => setValue(c.value)}
      row={(c) => ({ label: <span className="face-mono">{c.label}</span> })}
    />
  );
}

/** An inline trigger, searchable, two-line rows (the chat head ladder wears the same face). */
function PickerChipSpecimen() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <ListPopup<Choice>
      anchor="trigger"
      triggerLabel="Category"
      trigger={
        <span className="face-mono">
          {CHOICES.find((c) => c.value === picked)?.label ?? "category"}
        </span>
      }
      aria-label="Category"
      items={CHOICES}
      keyOf={(c) => c.value}
      labelOf={(c) => c.label}
      filter="substring"
      searchPlaceholder="Search category…"
      select="single"
      selected={picked ? [picked] : []}
      empty="no categories"
      onPick={(c) => setPicked(c.value)}
      row={(c) => ({ label: c.label, sub: c.description, lines: c.description ? 2 : 1 })}
    />
  );
}

function FieldSelectSpecimen() {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <div className="w-44">
      <FieldOptionSelect
        items={FIELD_OPTIONS}
        value={value}
        placeholder="Source element…"
        onChange={(option) => setValue(option.value)}
      />
    </div>
  );
}

function FieldMultiSpecimen() {
  const [values, setValues] = useState<string[]>([]);
  return (
    <div className="flex w-44 flex-col gap-0.5">
      <FieldOptionPicker items={FIELD_OPTIONS} values={values} onChange={setValues} />
    </div>
  );
}

const SPECIMENS = [
  { name: "Tooltip", render: HintSpecimen },
  { name: "Popover", render: ClickSpecimen },
  { name: "HoverCard", render: HoverSpecimen },
  { name: "Facet filter", render: FacetFilterSpecimen },
  { name: "Picker chip", render: PickerChipSpecimen },
  { name: "Field select", render: FieldSelectSpecimen },
  { name: "Multi select", render: FieldMultiSpecimen },
];
function PopoverHarness() {
  const [selected, setSelected] = useState<Motif | null>(null);
  const [specimen, setSpecimen] = useState("Tooltip");
  const Specimen = SPECIMENS.find((item) => item.name === specimen)!.render;
  return (
    <main className="space-y-5 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to="/design-system">Back to design system</Link>
        <h1>Popovers</h1>
        <ThemeToggle />
      </header>
      <section aria-label="Floating family" className="space-y-2">
        <h2>Hint · detail · preview</h2>
        <p className="text-ink-2">
          Hints warm up in 350 ms. Interactive previews wait 500 ms and allow 200 ms to cross the
          gap. Escape dismisses.
        </p>
        <div className="flex flex-wrap gap-4">
          <HintSpecimen />
          <ClickSpecimen />
          <HoverSpecimen />
        </div>
      </section>
      <section aria-label="Resource preview motifs" className="space-y-2">
        <h2>Resource previews · choose a motif</h2>
        <p className="text-ink-2">
          Contract-shaped fixtures, not current resources. Hover to preview; click or Enter to
          inspect.
        </p>
        <div className="hairline-rows">
          {MOTIFS.map((motif) => (
            <div key={motif.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {motif.id} · {motif.name}
              </span>
              <HoverCard>
                <HoverCardTrigger
                  className="max-w-[55%] truncate"
                  aria-label={`Preview ${motif.id}: ${motif.label}`}
                >
                  {motif.label}
                </HoverCardTrigger>
                <HoverCardContent>
                  <ResourcePreview motif={motif} inspect={() => setSelected(motif)} />
                </HoverCardContent>
              </HoverCard>
            </div>
          ))}
        </div>
      </section>
      {selected ? (
        <section aria-label="Inspected fixture" className="space-y-2">
          <div className="flex justify-between">
            <h2>{selected.id} · fixture snapshot</h2>
            <Button label="Dismiss snapshot" onClick={() => setSelected(null)}>
              Dismiss
            </Button>
          </div>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap face-mono break-all">
            {JSON.stringify(selected.value, null, 2)}
          </pre>
        </section>
      ) : null}
      <section aria-label="Collision harness" className="space-y-2">
        <h2>Viewport edges</h2>
        <p className="text-ink-2">
          Scroll each edge into view. All seven real kit compositions share the same collision
          boundary.
        </p>
        <ListPopup
          anchor="trigger"
          triggerLabel="Position specimen"
          trigger={specimen}
          aria-label="Position specimen"
          items={SPECIMENS}
          keyOf={(item) => item.name}
          labelOf={(item) => item.name}
          select="single"
          selected={[specimen]}
          empty="No specimens"
          onPick={(item) => setSpecimen(item.name)}
          row={(item) => ({ label: item.name })}
        />
        <div className="grid h-[560px] grid-cols-3 grid-rows-3 gap-2" key={specimen}>
          {Array.from({ length: 9 }, (_, index) => (
            <div
              key={index}
              className="flex min-w-0"
              style={{
                justifyContent: ["start", "center", "end"][index % 3],
                alignItems: ["start", "center", "end"][Math.floor(index / 3)],
              }}
            >
              <Specimen />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
