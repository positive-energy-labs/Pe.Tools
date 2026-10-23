import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@pe/kit/lang/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@pe/kit/lang/tooltip";
import {
  Popover,
  PopoverTrigger,
  SubjectPopoverContent as PopoverContent,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from "@pe/kit/lang/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@pe/kit/lang/hover-card";
import { ThemeToggle } from "@pe/kit/lang/theme-toggle";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { Table } from "@pe/kit/table/table";
import { FieldOptionPicker, FieldOptionSelect, type FieldOption } from "#/host/field-options";
import { CATEGORY_OPTIONS } from "#/design-system/specimens-data";
import type { HostActiveDocumentSummary } from "@pe/host-contracts/operation-types";
import type { PodRouteDescriptor } from "@pe/host-contracts/pe-api";
import type { Machine } from "@pe/agent-contracts";
import { previousOf, useInventory, useReading } from "#/readings";
import { usePodRoutes } from "#/route/pod-routes";
import { hostFetch } from "#/host/runtime";

export const Route = createFileRoute("/design-system_/popovers")({ component: PopoverHarness });

const documentFixture = {
  title: "North wing · Mechanical",
  key: "fixture-document",
  path: "Models/North wing.rvt",
  isFamilyDocument: false,
  isModelInCloud: false,
  isWorkshared: true,
  observedAtUnixMs: Date.parse("2026-10-14T14:30:00Z"),
} satisfies HostActiveDocumentSummary;
const podFixture = {
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
type PagePeek = { title: string; url: string | null; slug: string };

/** Owner rulings 2026-10-14: a resource previews as a bare hint unless it declares state (G) or
 *  content (H); only a Page shows its miniature (F). */
function ResourcePreviews() {
  const inventory = useInventory();
  const session = previousOf(inventory)?.sessions.find((entry) => entry.activeDocumentTitle);
  const machineReading = useReading<Machine>({ kind: "machine" });
  const machine = previousOf(machineReading);
  const routes = usePodRoutes();
  const pod = routes?.rows[0] ?? podFixture;
  const [pages, setPages] = useState<PagePeek[]>([]);
  const [pageState, setPageState] = useState("Reading Pages from this host…");
  useEffect(() => {
    const abort = new AbortController();
    void hostFetch("/pages", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw Error(`Pages refused (${response.status})`);
        const { pages: rows } = (await response.json()) as { pages: PagePeek[] };
        setPages(rows);
        setPageState(
          rows.length
            ? "No Page on this host has an address."
            : "This host has no Pages. Import a Pod with a Page to inspect its render.",
        );
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setPageState(String(error));
      });
    return () => abort.abort();
  }, []);
  const page = pages.find((row) => row.url);
  const title = session?.activeDocumentTitle ?? documentFixture.title;
  const freshness = session ? inventory.state : "fixture · unavailable";
  return (
    <section aria-label="Resource previews" className="space-y-3">
      <h2>Resource previews</h2>
      <p className="text-ink-2">
        A bare hint by default. A resource that declares its state or content previews that; only a
        Page shows its render.
      </p>
      <div className="hairline-rows">
        <PreviewRow motif="E" name="Default · bare hint · Document">
          <Tooltip>
            <TooltipTrigger aria-label="Preview E">{title}</TooltipTrigger>
            <TooltipContent data-motif="E">
              {title} · {freshness}
            </TooltipContent>
          </Tooltip>
        </PreviewRow>
        <PreviewRow motif="G" name="Declared state · Pod route" label={pod.name} width="w-80">
          <div className="space-y-3">
            <p className="t-display" data-tone={pod.trusted ? "done" : "caution"}>
              {pod.trusted ? "Trusted" : "Not trusted"}
            </p>
            <p>
              {pod.name} · {pod.packageId}
            </p>
            <p>
              {pod.trusted
                ? "Admitted to the route loader."
                : "Execution is blocked until you grant trust."}
            </p>
            <p className="text-ink-2">
              {routes?.rows.length ? "Host route inventory" : "Fixture · host has no Pod route"}
            </p>
            <Link to="/tool/$key" params={{ key: pod.key }}>
              Review route
            </Link>
          </div>
        </PreviewRow>
        <PreviewRow
          motif="H"
          name="Declared content · Reading"
          label="Machine observations"
          width="w-[42rem]"
        >
          <div className="space-y-3">
            <div className="flex justify-between gap-2">
              <PopoverTitle>Machine observations</PopoverTitle>
              <span>{machineReading.state} · host Reading</span>
            </div>
            <p className="face-mono break-all">
              {machine?.host?.serviceName ?? "Waiting for host"}
            </p>
            <Table
              label="Reading rows"
              rows={Object.entries(machine?.legs ?? {}).map(([key, leg]) => ({ key, ...leg }))}
              rowKey={(row) => row.key}
              maxHeight="10rem"
              columns={[
                { key: "subject", label: "Subject", cell: (row) => row.key },
                {
                  key: "observed",
                  label: "Observed UTC",
                  cell: (row) => <span className="face-mono">{row.observedAtUtc ?? "Never"}</span>,
                },
                {
                  key: "result",
                  label: "Result",
                  cell: (row) => row.error ?? (row.observedAtUtc ? "Observed" : "Not observed"),
                },
              ]}
              empty={
                machineReading.state === "failed" ? machineReading.message : "No observation yet."
              }
            />
            <Link to="/settings">Open Settings</Link>
          </div>
        </PreviewRow>
        <PreviewRow
          motif="F"
          name="Page miniature"
          label={page?.title ?? "No Page"}
          width="w-[28rem] p-0"
        >
          <figure>
            {page?.url ? (
              <div className="h-56 overflow-hidden" aria-hidden="true">
                {/* Pages draw with script; an opaque origin keeps the app out of their reach. */}
                <iframe
                  title={`Page miniature: ${page.title}`}
                  src={page.url}
                  sandbox="allow-scripts"
                  className="h-[28rem] w-[200%] origin-top-left scale-50 pointer-events-none"
                  tabIndex={-1}
                />
              </div>
            ) : (
              <p className="p-4">{pageState}</p>
            )}
            <figcaption className="flex items-center justify-between gap-3 p-3">
              <span>{page?.title ?? "Page unavailable"} · live render, isolated from this app</span>
              {page?.url ? (
                <a href={page.url} target="_blank" rel="noreferrer">
                  Open Page
                </a>
              ) : null}
            </figcaption>
          </figure>
        </PreviewRow>
      </div>
    </section>
  );
}

function PreviewRow({
  motif,
  name,
  label,
  width,
  children,
}: {
  motif: string;
  name: string;
  /** Absent, `children` is the whole hover (a bare hint draws its own trigger). */
  label?: string;
  width?: string;
  children: ReactNode;
}) {
  return (
    <article data-lineup={motif} className="flex flex-wrap items-center justify-between gap-2 py-3">
      <h3>
        {motif} · {name}
      </h3>
      {label === undefined ? (
        children
      ) : (
        <HoverCard>
          <HoverCardTrigger aria-label={`Preview ${motif}`}>{label}</HoverCardTrigger>
          <HoverCardContent data-motif={motif} aria-label={`${name} preview`} className={width}>
            {children}
          </HoverCardContent>
        </HoverCard>
      )}
    </article>
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
      <ResourcePreviews />
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
