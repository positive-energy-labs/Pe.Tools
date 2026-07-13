import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";

export const Route = createFileRoute("/poc/type")({ component: TypePoc });

// ── Tier utilities ───────────────────────────────────────────────────────────
// The proposed two-tier system as reusable class strings. Body/UI stay in the
// inherited Open Sans; the telemetry tier switches to var(--font-pe-mono) with
// positive tracking. `mono` is applied inline as a style so the token is visible
// in the spec below.
const MONO = "var(--font-pe-mono)";

const tier = {
  // 14px Open Sans — the working body register.
  body: "text-[14px] leading-relaxed",
  // 12px Open Sans — quiet UI chrome (labels, hints, controls).
  uiLabel: "text-[12px] text-muted-foreground",
  // 12px mono, tracked — machine truth in running rows.
  tele: "text-[12px] tracking-[0.05em]",
  // 11px mono, uppercase, wider tracking — telemetry field labels / statuses.
  teleLabel: "text-[11px] uppercase tracking-[0.08em]",
} as const;

// ── Mock data ─────────────────────────────────────────────────────────────────
interface Trace {
  ts: string;
  tool: string;
  title: string;
  dur: number; // ms
  status: "OK" | "CACHE" | "ERR" | "RUN";
  tokens: number;
  id: string;
}

const TRACES: Trace[] = [
  {
    ts: "14:02:11.204",
    tool: "host.family_read",
    title: "Read family parameters for FA-Door-Single",
    dur: 142,
    status: "OK",
    tokens: 1240,
    id: "trc_8f2a",
  },
  {
    ts: "14:02:11.361",
    tool: "revit.element_query",
    title: "Query all instances in active view",
    dur: 88,
    status: "CACHE",
    tokens: 96,
    id: "trc_8f2b",
  },
  {
    ts: "14:02:12.009",
    tool: "host.type_catalog",
    title: "List available family types (built-in)",
    dur: 431,
    status: "OK",
    tokens: 3420,
    id: "trc_8f2c",
  },
  {
    ts: "14:02:12.550",
    tool: "script.execute",
    title: "Run bounding-box collision pass",
    dur: 1204,
    status: "RUN",
    tokens: 512,
    id: "trc_8f2d",
  },
  {
    ts: "14:02:13.812",
    tool: "revit.param_write",
    title: "Set Mark on 42 selected instances",
    dur: 366,
    status: "ERR",
    tokens: 210,
    id: "trc_8f2e",
  },
  {
    ts: "14:02:14.220",
    tool: "host.view_capture",
    title: "Capture floor plan L2 to PNG",
    dur: 2810,
    status: "OK",
    tokens: 64,
    id: "trc_8f2f",
  },
  {
    ts: "14:02:17.104",
    tool: "revit.family_place",
    title: "Place 3 instances at grid intersections",
    dur: 540,
    status: "OK",
    tokens: 880,
    id: "trc_8f30",
  },
  {
    ts: "14:02:17.699",
    tool: "host.doc_state",
    title: "Read document freshness + open worksets",
    dur: 47,
    status: "CACHE",
    tokens: 128,
    id: "trc_8f31",
  },
];

const THREAD = [
  { label: "context budget", meta: "72.4K", sub: "8 sections" },
  { label: "door schedule pass", meta: "OK", sub: "42 elements" },
  { label: "collision review", meta: "RUN", sub: "1.2s elapsed" },
  { label: "type reconciliation", meta: "ERR", sub: "2 conflicts" },
  { label: "view capture L2", meta: "OK", sub: "483.6 KiB" },
  { label: "workset freshness", meta: "CACHE", sub: "read 0.1K" },
];

const PAYLOAD = `{
  "tool": "revit.param_write",
  "target": "selection[42]",
  "param": "Mark",
  "value": "D-{index:03}",
  "error": {
    "code": "READONLY_PARAM",
    "detail": "Mark is type-driven on 2 instances",
    "instances": ["3f11a2", "3f11c8"]
  },
  "elapsed_ms": 366
}`;

// status → cat hue for the mono tier
const STATUS_HUE: Record<Trace["status"], string> = {
  OK: "var(--cat-green)",
  CACHE: "var(--cat-slate)",
  ERR: "var(--destructive)",
  RUN: "var(--cat-clay)",
};

// ── Page ───────────────────────────────────────────────────────────────────────
function TypePoc() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="page-wrap flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary" />
            <span className="text-sm font-semibold tracking-tight">Telemetry Type Tier</span>
            <span
              className="ml-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
              style={{ fontFamily: MONO }}
            >
              /poc/type
            </span>
            <Link to="/" className="ml-2 text-xs text-muted-foreground">
              ← tools
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-wrap flex flex-col gap-14 py-10">
        <Intro />
        <TierDefinitions />
        <TraceRows />
        <BudgetStrip />
        <SectionGrammar />
        <DensityLadder />
      </main>
    </div>
  );
}

// ── Specimen shell ─────────────────────────────────────────────────────────────
function Specimen({
  n,
  title,
  note,
  children,
}: {
  n: number;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <span
          className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
          style={{ fontFamily: MONO }}
        >
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      </div>
      <p className="max-w-[62ch] text-[13px] text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}

// column caption used to label competing treatments
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
      style={{ fontFamily: MONO }}
    >
      {children}
    </div>
  );
}

function Intro() {
  return (
    <p className="max-w-[68ch] text-[14px] leading-relaxed text-muted-foreground">
      The instrument-panel move: machine truth — timestamps, tool names, token counts, elapsed ms,
      statuses, ids — rendered in mono with positive tracking, sitting against a prose/UI layer in
      Open Sans. Every section is mock data. Judge whether the mono tier reads as PE-calm (a legible
      instrument) or as brutalist cosplay.
    </p>
  );
}

// ── 1. Tier definitions ────────────────────────────────────────────────────────
function TierDefinitions() {
  const rows: Array<{ name: string; spec: string; mono: boolean; sample: React.ReactNode }> = [
    {
      name: "display",
      spec: "Spectral · page-title size only",
      mono: false,
      sample: (
        <span style={{ fontFamily: "var(--font-pe-display)" }} className="text-[22px]">
          Family reconciliation
        </span>
      ),
    },
    {
      name: "body",
      spec: "14px · Open Sans · working prose",
      mono: false,
      sample: (
        <span className={tier.body}>Two instances carry a type-driven Mark and were skipped.</span>
      ),
    },
    {
      name: "ui-label",
      spec: "12px · Open Sans · quiet chrome",
      mono: false,
      sample: <span className={tier.uiLabel}>3 of 42 instances affected</span>,
    },
    {
      name: "tele",
      spec: "12px · mono · tracking .05em",
      mono: true,
      sample: (
        <span className={tier.tele} style={{ fontFamily: MONO }}>
          14:02:13.812 · 366ms · trc_8f2e
        </span>
      ),
    },
    {
      name: "tele-label",
      spec: "11px · mono · uppercase · tracking .08em",
      mono: true,
      sample: (
        <span className={tier.teleLabel} style={{ fontFamily: MONO }}>
          cache-read · reprocessed · readonly
        </span>
      ),
    },
  ];

  return (
    <Specimen
      n={1}
      title="Tier definitions"
      note="The proposed utilities as a visible spec. Two families only — Open Sans for anything a human reads as language, mono for anything the machine measured. Spectral is a garnish reserved for the page title."
    >
      <div className="border-t border-border">
        {rows.map((r) => (
          <div
            key={r.name}
            className="grid grid-cols-[120px_1fr_minmax(0,1.4fr)] items-baseline gap-4 border-b border-border py-3"
          >
            <span
              className="text-[12px] tracking-[0.05em]"
              style={{ fontFamily: MONO, color: r.mono ? "var(--cat-blue)" : undefined }}
            >
              .{r.name}
            </span>
            <span className="text-[12px] text-muted-foreground">{r.spec}</span>
            <span>{r.sample}</span>
          </div>
        ))}
      </div>
    </Specimen>
  );
}

// ── 2. Trace rows ──────────────────────────────────────────────────────────────
function TraceRows() {
  const [expanded, setExpanded] = useState(false);

  return (
    <Specimen
      n={2}
      title="Trace rows"
      note="Eight mock tool-call rows in three treatments. (a) today's mixed sans, (b) full telemetry — mono tool name plus uppercase mono status/duration on hairline rows, (c) hybrid — sans row title with mono metadata right-aligned. One row is expanded to a JSON payload."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* (a) current mixed sans */}
        <div>
          <Caption>a · current (mixed sans)</Caption>
          <div className="border-t border-border">
            {TRACES.map((t) => (
              <div
                key={t.id}
                className="flex items-baseline justify-between gap-2 border-b border-border py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{t.tool}</div>
                  <div className="truncate text-[12px] text-muted-foreground">{t.title}</div>
                </div>
                <div className="shrink-0 text-right text-[12px] text-muted-foreground">
                  <div>{t.status}</div>
                  <div>{t.dur}ms</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* (b) full telemetry */}
        <div>
          <Caption>b · full telemetry (mono)</Caption>
          <div className="border-t border-border">
            {TRACES.map((t) => (
              <div
                key={t.id}
                className="flex items-baseline justify-between gap-2 border-b border-border py-1.5"
              >
                <div className="min-w-0" style={{ fontFamily: MONO }}>
                  <div
                    className="truncate text-[12px] tracking-[0.05em]"
                    style={{ color: "var(--cat-blue)" }}
                  >
                    {t.tool}
                  </div>
                  <div className="truncate text-[11px] tracking-[0.04em] text-muted-foreground">
                    {t.ts} · {t.id}
                  </div>
                </div>
                <div className="shrink-0 text-right" style={{ fontFamily: MONO }}>
                  <div
                    className="text-[11px] uppercase tracking-[0.08em]"
                    style={{ color: STATUS_HUE[t.status] }}
                  >
                    {t.status}
                  </div>
                  <div className="text-[11px] tracking-[0.05em] text-muted-foreground">
                    {t.dur}ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* (c) hybrid */}
        <div>
          <Caption>c · hybrid (sans + mono meta)</Caption>
          <div className="border-t border-border">
            {TRACES.map((t, i) => {
              const isExp = i === 4 && expanded;
              return (
                <div key={t.id} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => i === 4 && setExpanded((v) => !v)}
                    className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left"
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
                    <div
                      className="flex shrink-0 items-baseline gap-2"
                      style={{ fontFamily: MONO }}
                    >
                      <span
                        className="text-[11px] uppercase tracking-[0.08em]"
                        style={{ color: STATUS_HUE[t.status] }}
                      >
                        {t.status}
                      </span>
                      <span className="text-[11px] tracking-[0.05em] text-muted-foreground tabular-nums">
                        {t.dur}ms
                      </span>
                    </div>
                  </button>
                  {isExp && (
                    <pre
                      className="mb-1.5 overflow-x-auto rounded-sm border border-border bg-muted p-2 text-[11px] leading-relaxed"
                      style={{ fontFamily: MONO }}
                    >
                      {PAYLOAD}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            (row 5 is clickable → expands payload)
          </div>
        </div>
      </div>
    </Specimen>
  );
}

// ── 3. Context budget strip ────────────────────────────────────────────────────
const BUDGET = [
  { key: "system", pct: 18, cat: "--cat-slate" },
  { key: "skills", pct: 22, cat: "--cat-green" },
  { key: "messages", pct: 46, cat: "--cat-blue" },
] as const;

function BudgetBar() {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-sm border border-border">
      {BUDGET.map((s) => (
        <div
          key={s.key}
          style={{
            width: `${s.pct}%`,
            backgroundColor: `color-mix(in srgb, var(${s.cat}) 25%, transparent)`,
            borderRight: "1px solid var(--line)",
          }}
        />
      ))}
      <div className="flex-1" />
    </div>
  );
}

function BudgetLegend({ mono }: { mono: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {BUDGET.map((s) => (
        <span
          key={s.key}
          className="flex items-center gap-1.5"
          style={mono ? { fontFamily: MONO } : undefined}
        >
          <span
            className="size-2 rounded-[1px]"
            style={{
              backgroundColor: `color-mix(in srgb, var(${s.cat}) 25%, transparent)`,
              border: `1px solid var(${s.cat})`,
            }}
          />
          {mono ? (
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {s.key} {s.pct}%
            </span>
          ) : (
            <span className="text-[12px] text-muted-foreground">
              {s.key} · {s.pct}%
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function BudgetStrip() {
  return (
    <Specimen
      n={3}
      title="Context budget strip"
      note="The context ribbon: a segmented bar (system / skills / messages at cat-color /25 tints) with the raw figures. Same data, two type treatments — running prose in Open Sans vs. the telemetry tier in mono."
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* sans treatment */}
        <div className="flex flex-col gap-3 rounded-sm border border-border p-4">
          <Caption>sans figures</Caption>
          <BudgetBar />
          <div className="text-[13px] text-muted-foreground">
            2.4K of 72.4K used · cache-read 0.1K · reprocessed 4.3K
          </div>
          <BudgetLegend mono={false} />
        </div>

        {/* tele treatment */}
        <div className="flex flex-col gap-3 rounded-sm border border-border p-4">
          <Caption>tele figures</Caption>
          <BudgetBar />
          <div
            className="text-[12px] tracking-[0.05em] text-muted-foreground tabular-nums"
            style={{ fontFamily: MONO }}
          >
            2.4K / 72.4K
            <span className="mx-1.5 opacity-40">·</span>
            <span className="uppercase tracking-[0.08em]">cache-read</span> 0.1K
            <span className="mx-1.5 opacity-40">·</span>
            <span className="uppercase tracking-[0.08em]">reprocessed</span> 4.3K
          </div>
          <BudgetLegend mono />
        </div>
      </div>
    </Specimen>
  );
}

// ── 4. Section grammar ─────────────────────────────────────────────────────────
type HeaderStyle = "sans" | "bracket" | "smallcaps";

function PanelPair({ style }: { style: HeaderStyle }) {
  const panels: Array<{ head: string; rows: Array<[string, string]> }> = [
    {
      head: "Active worksets",
      rows: [
        ["Shared Levels and Grids", "OWNER · you"],
        ["Architecture", "OWNER · pea"],
        ["Interiors", "AVAILABLE"],
      ],
    },
    {
      head: "Freshness",
      rows: [
        ["Model read", "14:02:17 · 0.9s ago"],
        ["View capture", "STALE · 6m ago"],
        ["Catalog", "CACHE-READ"],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {panels.map((p) => (
        <div key={p.head} className="rounded-sm border border-border">
          <PanelHeader style={style}>{p.head}</PanelHeader>
          <div>
            {p.rows.map(([k, v]) => (
              <div
                key={k}
                className="flex items-baseline justify-between gap-2 border-t border-border px-3 py-1.5"
              >
                <span className="text-[13px]">{k}</span>
                <span
                  className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
                  style={{ fontFamily: MONO }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PanelHeader({ style, children }: { style: HeaderStyle; children: string }) {
  if (style === "sans") {
    return <div className="px-3 py-2 text-[13px] font-semibold tracking-tight">{children}</div>;
  }
  if (style === "bracket") {
    return (
      <div
        className="px-3 py-2 text-[12px] uppercase tracking-[0.08em]"
        style={{ fontFamily: MONO }}
      >
        <span className="text-muted-foreground">[ </span>
        {children}
        <span className="text-muted-foreground"> ]</span>
      </div>
    );
  }
  // smallcaps: uppercase tracked, Open Sans (no mono) — the calmest option
  return (
    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

function SectionGrammar() {
  return (
    <Specimen
      n={4}
      title="Section grammar"
      note="Panel headers three ways, each applied to two stacked mock panels: today's sans semibold, the [ SECTION ] mono-bracket signature, and uppercase-tracked small-caps in Open Sans."
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <div>
          <Caption>current · sans semibold</Caption>
          <PanelPair style="sans" />
        </div>
        <div>
          <Caption>[ bracket ] · mono</Caption>
          <PanelPair style="bracket" />
        </div>
        <div>
          <Caption>small-caps · tracked sans</Caption>
          <PanelPair style="smallcaps" />
        </div>
      </div>
    </Specimen>
  );
}

// ── 5. Density ladder ──────────────────────────────────────────────────────────
function ThreadList({ py }: { py: string }) {
  return (
    <div className="border-t border-border">
      {THREAD.map((t) => (
        <div
          key={t.label}
          className={`flex items-baseline justify-between gap-2 border-b border-border ${py}`}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            {/* weight + position carry emphasis; size delta is 1px max */}
            <span className="text-[13px] font-medium">{t.label}</span>
            <span className="truncate text-[12px] text-muted-foreground">{t.sub}</span>
          </div>
          <span
            className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
            style={{ fontFamily: MONO }}
          >
            {t.meta}
          </span>
        </div>
      ))}
    </div>
  );
}

function DensityLadder() {
  const rungs: Array<[string, string]> = [
    ["py-3 · roomy", "py-3"],
    ["py-2 · medium", "py-2"],
    ["py-1.5 · tight", "py-1.5"],
  ];
  return (
    <Specimen
      n={5}
      title="Density ladder"
      note="The same six-row thread list at three densities, with a deliberately flat size hierarchy (weight and position carry emphasis, at most a 1px size delta between title and metadata). Pick the canonical row height."
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {rungs.map(([label, py]) => (
          <div key={py}>
            <Caption>{label}</Caption>
            <ThreadList py={py} />
          </div>
        ))}
      </div>
    </Specimen>
  );
}
