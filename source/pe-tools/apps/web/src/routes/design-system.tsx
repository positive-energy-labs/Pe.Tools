/**
 * /design-system — THE INDEX. The design language, stated and demonstrated.
 *
 * THE INDEX LAW (ruled 2026-08-16): **nothing exists on this page unless it
 * is codified as a real component with a real — or soon-to-be — consumer.** The old 1,540-line
 * shadcn exhibit catalogued components nothing consumed; those are evicted, not
 * moved. Every specimen below is the production component, imported from where production
 * imports it, rendered under the tokens production runs under.
 *
 * NO STAND-INS. Where a component cannot express something the language needs, the page records a
 * `GAP:` at the call site and, where a reader would otherwise be misled, a visible gap-note. It
 * does NOT fork, wrap, or restyle the component to make the demo look finished. A workaround here
 * is worse than a defect: it is a defect that hides its own signal. The route records gaps while
 * the owning production component remains the place where they are fixed.
 *
 * THE ONE INTEGRATION THE PROTOTYPE COULD NOT DO: section 04 mounts the actual `MasterTable`
 * (the primitive atlas/takeoffs/families run on) with `StateCell` as its cell renderer. The
 * design-lang proto hand-rolled its table, so nothing had ever proven the grammar survives the
 * real primitive. It mostly does not yet — the gap notes in that section are the deliverable.
 *
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronsDownUp, RefreshCw, Save, Share2, Sparkles, Upload } from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CellStateKey } from "#/components/lang/cell-key";
import { CELL_STATE_ORDER, StateCell, cellStateLabel } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { FactChip, NarrowChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { Press } from "#/components/lang/press";
import { PARAM_ROWS, ageText, cellProps, type ParamRow } from "#/design-system/fixtures";

export const Route = createFileRoute("/design-system")({ component: DesignSystem });

const noop = () => {};

/** One fixture row by key. The specimens cite the fixture rather than restating it — a law
 *  demonstrated on props written to flatter it is not demonstrated. */
const row = (key: string) => PARAM_ROWS.filter((r) => r.key === key)[0];

/* ═══ page chrome ═══════════════════════════════════════════════════════════════════════════
   The page itself obeys the border budget it documents: sections are plain content under a
   quiet head with a hairline under it, and NOTHING on this page is enclosed except the three
   objects that are allowed to be — pea's card, the table, the arming strip. */

function Section({
  n,
  title,
  note,
  help,
  children,
}: {
  n: string;
  title: string;
  note: string;
  /** Region orientation — the HelpTip paradigm, beside the title it orients. */
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 border-b border-line pb-1.5">
        <span className="t-caption t-upper text-ink-mute">{n}</span>
        <span className="t-label t-upper">{title}</span>
        {help != null ? <HelpTip className="self-center">{help}</HelpTip> : null}
        <span className="t-label min-w-0 flex-1 text-ink-2">{note}</span>
      </div>
      {children}
    </section>
  );
}

/** Spec prose on the left, the living component on the right. The scaffold's whole framing. */
function Demo({
  label,
  spec,
  consumers,
  children,
}: {
  label: string;
  spec: React.ReactNode;
  /** Named inline, always — the index law is enforced by having to write this down. */
  consumers: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-3 border-b border-line py-4 last:border-b-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="face-mono t-label text-ink">{label}</span>
        <p className="t-prose text-ink-2">{spec}</p>
        <span className="t-caption text-ink-mute">consumers: {consumers}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A recorded gap, said out loud where a reader would otherwise think the demo was finished. */
function GapNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="face-mono t-caption max-w-[86ch] border-l border-line-2 pl-2 text-ink-2">
      <span className="text-caution">gap · </span>
      {children}
    </p>
  );
}

/** The wrong way — a real component, used against its own ruling, quietly struck. */
function CounterExample({ why, children }: { why: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 opacity-55">
      <div className="w-fit">{children}</div>
      <span className="face-mono t-caption text-ink-mute">
        <span className="line-through">the wrong way</span> — {why}
      </span>
    </div>
  );
}

/** A quiet caption under a specimen. */
function Cap({ children }: { children: React.ReactNode }) {
  return <span className="face-mono t-caption text-ink-2">{children}</span>;
}

/* ═══ 00 · the page ═════════════════════════════════════════════════════════════════════════ */

function DesignSystem() {
  return (
    <div className="t-prose min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-sticky border-b border-line bg-page/90 backdrop-blur">
        <div className="page-wrap flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="t-title face-display">Design system</span>
            <span className="t-caption t-upper text-ink-mute">the language, catalogued</span>
            <Link to="/" className="t-label text-nav hover:underline">
              ← tools
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-wrap flex flex-col gap-14 pt-8 pb-24">
        <Thesis />
        <Laws />
        <Tokens />
        <Catalogue />
        <RealTable />
        <Satellites />
      </main>
    </div>
  );
}

/* ═══ 01 · thesis ═══════════════════════════════════════════════════════════════════════════ */

function Thesis() {
  return (
    <section className="flex flex-col gap-3">
      <p className="t-display face-display">One cell grammar, at three scales.</p>
      <p className="t-prose max-w-[74ch] text-ink-2">
        Pea proposes; you decide; the model is allowed to disagree. Every surface in pe-tools has to
        say those three things at a glance, and the language does it with one treatment used at
        three sizes — the value inside a table cell, the value inside pea&apos;s chat card, and the
        whole write inside an arming strip are the same marks, scaled. Colour is spent only where a
        hue is a meaning; type carries the rest.
      </p>
      <p className="t-value max-w-[74ch] text-ink-mute">
        This page catalogues the components that are that language. It is a spec and a demonstration
        at once: the prose states the ruling, the specimen beside it is the shipping component
        obeying it. Where the component cannot obey it yet, the page says so.
      </p>
    </section>
  );
}

/* ═══ 02 · laws ═════════════════════════════════════════════════════════════════════════════
   THE DESIGN LAW (ruled 2026-08-16): docs/design/SURFACE-PHILOSOPHY.md is prose law; this route is
   the executable one. A position that CAN be rendered with a shipping component migrates here as
   a live specimen and collapses to a one-line pointer in the doc. What stays prose over there is
   the honest list of what nothing can render yet, plus the process rules that never will. */

/* Declared in a deliberately unhelpful order and sorted by the SHIPPING constant, so the
   specimen below cannot drift from what a state column with no explicit `sort` actually does. */
const ORDER_SPECIMENS: readonly StateCellProps[] = [
  { value: "26 in", fresh: "unverified" },
  { value: "84 in", cap: "readonly" },
  { value: "36 in", stage: "staged" },
  { value: "24 in" },
  { value: "1.75 in", agree: "drift", modelValue: "1.375 in" },
  { value: "2 hr", stage: "proposed" },
  { value: "5.5 in", fresh: "stale" },
];

const ORDERED_SPECIMENS = [...ORDER_SPECIMENS].sort(
  (a, b) =>
    CELL_STATE_ORDER.indexOf(cellStateLabel(a)) - CELL_STATE_ORDER.indexOf(cellStateLabel(b)),
);

const LAWS: readonly { name: string; text: string; demo: React.ReactNode }[] = [
  {
    name: "one alarm",
    text: "--pe-alarm means the model disagrees. Nothing else in the product may wear it — not an error, not a warning, not a destructive verb. A busy bridge gets caution, because a busy bridge is not the model disagreeing.",
    demo: <StateCell value="1.75 in" agree="drift" modelValue="1.375 in" />,
  },
  {
    name: "pea is never blue",
    text: "The agent's proposals wear the agent's identity — palm green — at every scale. Blue belongs to writes that leave the page, so a blue proposal would read as already committed.",
    demo: <StateCell value="2 hr" stage="proposed" />,
  },
  {
    name: "one filled blue",
    text: "The only filled blue in the language is the verb that writes beyond the page. Nav is the same blue as TEXT, byte-identical, and the job carries the difference so no second blue is minted.",
    demo: (
      <span className="flex items-center gap-2">
        <Verb
          tone="commit"
          label="apply to Revit"
          icon={Upload}
          onClick={noop}
          reason="Writes 42 parameters into the live model"
        />
        <Verb
          tone="nav"
          direction="out"
          label="open in RHVAC"
          onClick={noop}
          reason="Opens this system in RHVAC"
        />
      </span>
    ),
  },
  {
    name: "selection is a fill",
    text: "Selection, focus and hover buy no hue, ever. Selection is literally the fourth rung of the ground ladder (--pe-select); hover is one neutral ink veil identical on every control. The law is structural, not remembered.",
    demo: (
      <span className="flex items-center gap-2">
        <span className="t-label bg-select px-2 py-1">selected row</span>
        <Verb label="hover me" onClick={noop} reason="Takes the one veil — no hue" />
      </span>
    ),
  },
  {
    name: "bold = unsaved",
    text: "The weight axis is reserved for your unsaved edit and spent on nothing else, anywhere. Pea's proposal does not take it: the wash already said the same thing, and spending the axis twice would leave nothing to say it with.",
    demo: <StateCell value="36 in" stage="staged" />,
  },
  {
    name: "the squiggle family",
    text: "One decoration family carries state of the value, ranked by colour: drift ▸ stale ▸ unverified. One winner draws, the losers draw nothing. A PLAIN underline is a citation and lives on a different element, so it can never contend for the slot.",
    demo: (
      <span className="flex flex-wrap items-baseline gap-4">
        <StateCell value="5.5 in" fresh="stale" />
        <StateCell value="26 in" fresh="unverified" />
        <StateCell value="2 hr" grounding={{ doc: "RFI-217", page: 2 }} />
      </span>
    ),
  },
  {
    name: "the border budget",
    text: "Plain content is never enclosed. The artifact frame is reserved for a machine-operated object that carries state — the table, pea's card, the arming strip, the sentence. A lane of plain controls or receipts sits on the page ground with nothing around it.",
    demo: (
      <div className="w-full max-w-sm">
        <ArtifactFrame head={<span className="dl-tag">framed — carries state</span>}>
          <div className="px-2.5 py-2">
            <StateCell value="2 hr" stage="proposed" />
          </div>
        </ArtifactFrame>
        <div className="pt-2">
          <OutcomeLine
            kind="receipt"
            label="42 parameters written"
            says="unframed — plain content"
          />
        </div>
      </div>
    ),
  },
  {
    name: "mono means measured",
    text: "Mono is not chrome. It marks what a machine measured: counts, hashes, timestamps, states, footlines. Type carries meaning on the same terms colour does, which is what lets the colour budget stay small.",
    demo: (
      <FactChip title="A machine-measured fact: the plan this write was made against.">
        plan a91f#c04
      </FactChip>
    ),
  },
  {
    name: "cell state, not columns",
    text: "A value's real dimensions — which attribute, which entity — are the grid. Everything else you know about it is a pseudo-dimension, and it is not a column: three columns that are all readings of the same coordinate pair are one column and a mode switch. Pseudo-dimensions render as cell state instead.",
    demo: (
      // width is explicit because `.dl-foot` is `nowrap` and clamps only inside a bounded block —
      // in the table the column supplies that bound; here nothing does.
      <span className="flex w-[19rem] max-w-full flex-col gap-1.5">
        <StateCell {...cellProps(row("connectedLoad"))} />
        <Cap>
          one coordinate, three readings — pea proposes, you hold, the model disagrees. The body,
          the squiggle and the struck ghost carry all three. None of them bought a column.
        </Cap>
      </span>
    ),
  },
  {
    name: "sort by domain order",
    text: "State columns sort in the order attention is owed — fix the drift, review the proposal, commit the staged, re-read the stale, check the unverified, leave clean alone, locked last — never alphabetically. CELL_STATE_ORDER is that order, and a state column with no explicit sort takes it, so the ranking is a constant rather than a habit.",
    demo: (
      <span className="flex flex-col gap-1">
        {ORDERED_SPECIMENS.map((p) => (
          <span key={cellStateLabel(p)} className="flex items-baseline gap-2">
            <span className="face-mono t-caption w-16 shrink-0 text-ink-mute">
              {cellStateLabel(p)}
            </span>
            <StateCell {...p} />
          </span>
        ))}
      </span>
    ),
  },
  {
    name: "a filter's vocabulary is stable",
    text: "Facet options derive from ALL rows, never the visible subset, so an option never vanishes or reshuffles under the cursor and picking one can always widen the scope back out. The price is that a chosen option may resolve to zero visible rows — which the empty state says, and which is a better answer than an option that quietly disappeared.",
    demo: (
      <Cap>
        the exhibit is §04 below, live: filter it to instance scope, then open the value column's
        filter — every state word is still there, because facetOptions reads the whole row set.
      </Cap>
    ),
  },
  {
    name: "refuse per option",
    text: "List the option you cannot pick, greyed, with its own reason drawn from real validation — strictly more informative than hiding it or greying the whole control. What keeps that true is that the explanation is a required constructor argument: Verb demands a reason, so every refusal at every call site has one. The reason's home is the title (ruled 2026-08-16 on the live takeoffs header): dense chrome never pays a second line, and a lane of four refusals repeating one sentence read as noise, not honesty. The one exception (fit reviews, same date): a DISABLED commit verb says its reason on the surface — a small quiet line beside the verb — because the highest-stakes refusal must pass §0's no-tooltips bar and the lane-spam argument never applied to the lone page-blast verb.",
    demo: (
      <span className="flex flex-col gap-3">
        <span className="flex flex-wrap items-start gap-2">
          <Verb
            tone="commit"
            label="apply to Revit"
            icon={Upload}
            onClick={noop}
            reason="Writes 42 parameters into the live model"
          />
          <Verb
            tone="commit"
            label="sync to .r10"
            icon={Share2}
            onClick={noop}
            disabled
            reason="no .r10 target bound — bind one in the sentence first"
          />
        </span>
        <CounterExample why="the same refusal as surface machinery. Press is the right control for a tab or a close ×, and it takes no reason — so the greying is unfalsifiable and a reader cannot tell a rule from a bug. A control that acts on the world is a Verb, and requiring the string is the enforcement.">
          <Press
            disabled
            className="inline-flex h-6 shrink-0 items-center rounded-md border border-line px-2 t-value font-medium text-ink disabled:opacity-50"
          >
            sync to .r10
          </Press>
        </CounterExample>
      </span>
    ),
  },
  {
    name: "orientation hides behind a mark",
    text: "A title carries a CONTROL-level fact — what pressing does, why it refuses — terse and machine-adjacent, as everywhere today. A HelpTip orients a REGION: what this pane, section or table IS and how to think about it, one per region, beside its title, never on a control. Inline explanatory prose baked into chrome is neither, and dies: its content moves into one of these two homes or it was decoration. (Ruled 2026-08-16; the copy census will drive the purge.)",
    demo: (
      <span className="flex items-center gap-2">
        <span className="t-label t-upper">the real table</span>
        <HelpTip>
          The product table primitive with the cell grammar as its renderer. Rows never grow; the
          readout band under the table speaks for the focused cell. This tip is the paradigm: region
          orientation lives here, control facts stay on the controls.
        </HelpTip>
      </span>
    ),
  },
  {
    name: "a stand-in announces itself",
    text: "A surface with no such mark is claiming to be real, and that claim has to be true. In the UI the broken edge means ONE thing — seam: declared, with nothing real behind it. A technical drawing is the exception, and it is a real one: draughting has always used broken lines as a vocabulary, so drawings get two more NAMED roles and nothing else. Three roles, one authority in base.css; no call site names a pattern, and a surface that serializes a drawing reads the same values through lib/token.ts.",
    demo: (
      <span className="flex items-center gap-3">
        <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
          fixture
        </FactChip>
        <svg width="150" height="34" aria-label="the two drawing roles" className="shrink-0">
          <line
            x1={2}
            y1={9}
            x2={110}
            y2={9}
            stroke="currentColor"
            strokeWidth={1}
            className="dash-reference"
          />
          <text x={116} y={12} className="face-mono t-caption" fill="currentColor">
            reference
          </text>
          <rect
            x={2}
            y={19}
            width={108}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className="dash-void"
          />
          <text x={116} y={29} className="face-mono t-caption" fill="currentColor">
            void
          </text>
        </svg>
      </span>
    ),
  },
  {
    name: "type is tier × face × case",
    text: "A call site never names a pixel. Seven tiers carry their own leading, and each one is a ROLE, not a size: caption is machine chrome, label is a field name, value is a datum, prose is something a person reads, title names a region, head names the whole surface, display is the front door. Adding a rung takes the same bar as adding a state word — t-head exists because three route headings had landed at 20, 24 and 30px with nothing to sit on.",
    demo: (
      <span className="flex flex-col gap-0.5">
        {(
          [
            ["t-caption", "the machine's own chrome"],
            ["t-label", "field name"],
            ["t-value", "42.5 sf"],
            ["t-prose", "something a person reads"],
            ["t-title", "a region"],
            ["t-head", "the surface"],
          ] as const
        ).map(([tier, sample]) => (
          <span key={tier} className="flex items-baseline gap-2">
            <span className="face-mono t-caption w-16 shrink-0 text-ink-mute">{tier}</span>
            <span className={tier}>{sample}</span>
          </span>
        ))}
      </span>
    ),
  },
  {
    name: "provenance rides with the value",
    text: "Where a number came from travels with the number, everywhere it appears — not parked in a detail pane a reader has to open. And provenance that cannot be wrong is decoration: a freshness token that is always null means the surface can never show stale, which is a defect, not an empty field.",
    demo: (
      // the long-value row on purpose: the citation has to survive the footline clamp, or the
      // specimen truncates the very thing the law is about.
      <span className="block w-[19rem] max-w-full">
        <StateCell {...cellProps(row("typeComments"))} />
      </span>
    ),
  },
  {
    name: "ceremony scales with blast radius",
    text: "A verb that writes beyond the page carries a human-readable reason supplied before it arms, explicit identity in the call rather than whatever is selected, the plan hash it was made against with a drift refusal, and a receipt whose failures stay staged for retry. Presented as an arming strip, never at hover height.",
    demo: (
      <span className="flex flex-col gap-1">
        <Link to="/design-system/arming" className="t-value text-nav hover:underline">
          /design-system/arming
        </Link>
        <Cap>
          the satellite IS this law — freezing one frame here would teach the shape and hide the
          mechanism.
        </Cap>
      </span>
    ),
  },
];

function Laws() {
  return (
    <Section
      n="01"
      title="the laws"
      note="fifteen rules that decide every surface — each with the shipping component obeying it. A position lives here the moment a real component can render it; SURFACE-PHILOSOPHY keeps only what nothing can render yet"
    >
      <div className="border-t border-line">
        {LAWS.map((law) => (
          <div
            key={law.name}
            className="grid grid-cols-1 items-start gap-x-6 gap-y-2 border-b border-line py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,20rem)]"
          >
            <span className="t-caption t-upper text-ink">{law.name}</span>
            <p className="t-prose text-ink-2">{law.text}</p>
            <div className="flex flex-wrap items-center gap-2 sm:justify-self-end">{law.demo}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ═══ 03 · tokens ═══════════════════════════════════════════════════════════════════════════ */

interface TokenSpec {
  token: string;
  means: string;
  /** How the two sibling renderings differ — this is the pairing table's payload, in one line. */
  modes: string;
}

const TOKEN_GROUPS: readonly { group: string; asks: string; tokens: readonly TokenSpec[] }[] = [
  {
    group: "grounds",
    asks: "what surface is this sitting on?",
    tokens: [
      {
        token: "--pe-page",
        means: "the page itself; prose and page chrome",
        modes: "L .985 ↔ .185 — one hue (88°) in both modes",
      },
      {
        token: "--pe-artifact",
        means: "the machine-operated object: table, card, strip",
        modes: "one lightness step off the page, both modes",
      },
      {
        token: "--pe-recess",
        means: "set INTO an artifact: head/foot bands, the key",
        modes: "same step size again — the ladder is even",
      },
      {
        token: "--pe-select",
        means: "selection + focus fill. never a hue",
        modes: "rung 4; the no-hue law made structural",
      },
    ],
  },
  {
    group: "inks",
    asks: "how loud is this text allowed to be?",
    tokens: [
      {
        token: "--pe-ink",
        means: "primary text: values, labels, prose",
        modes: "inverted pair on the ground's own hue",
      },
      {
        token: "--pe-ink-2",
        means: "annotations, footlines, captions, counts",
        modes: "light value sits AT the meaning band's lightness",
      },
      {
        token: "--pe-ink-mute",
        means: "locked · dropped · the 'never checked' squiggle",
        modes: "near-achromatic; ~0 drift and ~0 ΔL across modes",
      },
    ],
  },
  {
    group: "hairlines",
    asks: "is this a seam, or a box?",
    tokens: [
      {
        token: "--pe-line",
        means: "quiet: row rules, the artifact frame's inset edge",
        modes: "ink @12% ↔ @14% — derived, so it rides the hue free",
      },
      {
        token: "--pe-line-2",
        means: "firm: seams, citation underline, chip edge, focus",
        modes: "ink @22% ↔ @26%",
      },
    ],
  },
  {
    group: "meanings",
    asks: "what fact is this hue standing for?",
    tokens: [
      {
        token: "--pe-pea",
        means: "pea's MARK: proposal ring, corner fold, card edge",
        modes: "the display rung — band lightness stepped 0.08 toward its ground",
      },
      {
        token: "--pe-pea-ink",
        means: "pea at ink weight: pea's text, the wash source",
        modes: "on-band, both modes; h158 unmoved",
      },
      {
        token: "--pe-alarm",
        means: "THE one alarm: drift, refusal, the ghost value",
        modes: "the one legislated off-band token (+35% chroma), both modes",
      },
      {
        token: "--pe-caution",
        means: "stale · unverified · unsaved · partial · error",
        modes: "on-band; 2.8× the incumbent kiln's chroma",
      },
      {
        token: "--pe-done",
        means: "it landed: receipts, the post-commit sentence",
        modes: "on-band; 25° from pea — adjacent, not equal",
      },
      {
        token: "--pe-commit",
        means: "the only filled blue: writes beyond the page",
        modes: "PE blue's exact hue, band-quantized",
      },
      {
        token: "--pe-on-commit",
        means: "text/icon sitting on a commit fill",
        modes: "= --pe-page. no pure white or black exists in the set",
      },
      {
        token: "--pe-nav",
        means: "nav as blue TEXT — back · forward · out",
        modes: "byte-identical to commit; the job carries the difference",
      },
    ],
  },
  {
    group: "viz",
    asks: "which series is this? (kind, never state)",
    tokens: [
      {
        token: "--viz-1",
        means: "series 1 — carries the old cat-blue identity",
        modes: "band-quantized: L .470 ↔ .795, hue unmoved",
      },
      {
        token: "--viz-2",
        means: "series 2 — old cat-green",
        modes: "same band; no series out-shouts another",
      },
      {
        token: "--viz-3",
        means: "series 3 — old cat-slate (low chroma)",
        modes: "C .045 keeps its near-neutral character",
      },
      { token: "--viz-4", means: "series 4 — old cat-lichen", modes: "on-band" },
      {
        token: "--viz-5",
        means: "series 5 — old cat-clay",
        modes: "on-band; a chart clay is not the alarm",
      },
      {
        token: "--viz-6",
        means: "series 6 — old cat-kiln (low chroma)",
        modes:
          "C .055. THE GRAYSCALE LAW: a viz spend must survive grayscale — label, legend, or position carries the distinction",
      },
    ],
  },
];

/** Read the live values off :root, and re-read when the theme class flips. The page reports the
 *  contract rather than restating it — re-pitching a token shows up here untouched. */
function useTokenValues(tokens: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(tokens.map((t) => [t, style.getPropertyValue(t).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
    // token list is a module constant; re-reading on theme flips is the only dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return values;
}

function Tokens() {
  const all = useMemo(() => TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.token)), []);
  const values = useTokenValues(all);

  return (
    <Section
      n="02"
      title="tokens"
      note="eighteen, and every one of them is oklch(L C h) off a declared band — src/base.css is the one place a colour is decided"
    >
      <p className="t-prose max-w-[80ch] text-ink-2">
        <code className="face-mono t-label">--pe-*</code> is canon. The old{" "}
        <code className="face-mono t-label">--act-*</code> /{" "}
        <code className="face-mono t-label">--st-*</code> /{" "}
        <code className="face-mono t-label">--cat-*</code> role vocabulary in{" "}
        <code className="face-mono t-label">styles.css</code> is retired and removed. The repo guard
        rejects its reintroduction; <code className="face-mono t-label">--pe-*</code> is the sole
        authority. Swatches below are read off <code className="face-mono t-label">:root</code> at
        render and re-read when you flip the theme — this table cannot drift from the stylesheet.
      </p>

      {TOKEN_GROUPS.map((g) => (
        <div key={g.group} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3 border-b border-line pb-1">
            <span className="t-caption t-upper text-ink">{g.group}</span>
            <span className="t-caption text-ink-mute italic">{g.asks}</span>
          </div>
          {g.tokens.map((t) => (
            <div
              key={t.token}
              className="grid grid-cols-[2.25rem_minmax(0,10rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 sm:grid-cols-[2.25rem_minmax(0,10rem)_minmax(0,1fr)_minmax(0,20rem)]"
            >
              <span
                className="h-5 w-9 shrink-0 border border-line-2"
                style={{ backgroundColor: `var(${t.token})` }}
                title={values[t.token] ?? t.token}
              />
              <span className="face-mono t-caption truncate">{t.token}</span>
              <span className="t-label min-w-0 text-ink-2">{t.means}</span>
              <span className="t-caption col-span-3 text-ink-mute sm:col-span-1">{t.modes}</span>
            </div>
          ))}
        </div>
      ))}

      <GapNote>
        the swatch reads a resolved value for every token except the two hairlines, which are
        declared as <code>color-mix()</code> and read back unresolved. Nothing is wrong with the
        colour; the ledger of computed contrast lives in the header of <code>src/base.css</code>{" "}
        because no component can compute it.
      </GapNote>
    </Section>
  );
}

/* ═══ 04 · the catalogue ════════════════════════════════════════════════════════════════════ */

function Catalogue() {
  return (
    <Section
      n="03"
      title="the catalogue"
      note="one block per components/lang primitive — the shipping component, the states that matter, and who consumes it"
    >
      <ArtifactFrameBlock />
      <VerbBlock />
      <ChipBlock />
      <StateCellBlock />
      <CellKeyBlock />
      <OutcomeBlock />
      <ArmingBlock />
    </Section>
  );
}

function ArtifactFrameBlock() {
  return (
    <Demo
      label="ArtifactFrame"
      consumers="the master-table wrapper (§04 below); pea's chat proposal card (/design-system/proposal-flow); ArmingStrip, which draws its own; soon: the addressing sentence"
      spec={
        <>
          The language&apos;s one enclosure: a ground shift plus a quiet inset hairline. No radius,
          no shadow — round 1 ruled that fills separate and outline borders do not. Optional
          recessed head and foot bands re-declare <code className="face-mono t-label">--pe-on</code>
          , so every wash a child mixes lands on the ground it is actually standing on.
        </>
      }
    >
      <div className="max-w-md">
        <ArtifactFrame
          head={
            <>
              <span className="dl-tag">overhead coiling door 421</span>
              <FactChip title="Rows currently in scope.">13 params</FactChip>
              <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
                fixture
              </FactChip>
            </>
          }
          foot={
            <>
              <span className="dl-tag">2 unsaved</span>
              <Verb
                tone="commit"
                label="save profile"
                icon={Save}
                onClick={noop}
                reason="Writes both staged values into the family profile"
              />
            </>
          }
        >
          <div className="flex flex-col gap-2 px-2.5 py-2.5">
            <StateCell value="2 hr" stage="proposed" note="matches the UL listing" />
            <StateCell value="36 in" stage="staged" />
          </div>
        </ArtifactFrame>
      </div>

      <CounterExample why="an outcomes lane reports on a machine-operated object; it is not one. Framing plain content makes the four real frames read as less special.">
        <ArtifactFrame>
          <div className="px-2.5 py-1.5">
            <OutcomeLine kind="receipt" label="42 parameters written" says="it landed" />
          </div>
        </ArtifactFrame>
      </CounterExample>

      <GapNote>
        the frame has a head slot, a foot slot and one undifferentiated children slot. A block that
        must sit last inside the frame — the cell-state key in §04 — gets there only because the
        author wrote it last, which the type cannot enforce. The foot band is a flex control bar and
        cannot hold a full-width block at all.
      </GapNote>
    </Demo>
  );
}

function VerbBlock() {
  return (
    <Demo
      label="Verb · VerbGroup"
      consumers="ArmingStrip (shipping); pea's card accept/deny (/design-system/proposal-flow); soon: the family clean-room verb lane, the takeoff panes. components/lang/verb.tsx serves the shared action grammar"
      spec={
        <>
          Four tones, and the tones are the whole colour story: <em>act</em> is neutral,{" "}
          <em>agent</em> is pea&apos;s own (the missing slot that made pea&apos;s own verb illegal),{" "}
          <em>commit</em> is the one filled blue, <em>nav</em> is blue text with a required
          direction. Blast radius groups the lane and buys no hue. A refusal always has a reason —
          the constructor demands it — carried as the title, except a disabled commit verb, which
          says it on the surface (fit reviews, 2026-08-16).
        </>
      }
    >
      <div className="flex flex-wrap gap-x-10 gap-y-5">
        <VerbGroup title="stays here" radius="page · document">
          <Verb
            label="collapse"
            icon={ChevronsDownUp}
            onClick={noop}
            reason="Folds every group in this pane"
          />
          <Verb label="refresh" icon={RefreshCw} onClick={noop} reason="Re-reads the model" />
          <Verb
            tone="agent"
            label="ask pea"
            icon={Sparkles}
            onClick={noop}
            reason="Hands this scope to pea"
          />
        </VerbGroup>

        <VerbGroup title="goes somewhere" radius="nav splits three ways">
          <Verb
            tone="nav"
            direction="back"
            label="all types"
            onClick={noop}
            reason="Back to the type list"
          />
          <Verb
            tone="nav"
            direction="forward"
            label="open family"
            onClick={noop}
            reason="Into this family"
          />
          <Verb
            tone="nav"
            direction="out"
            label="open in RHVAC"
            onClick={noop}
            reason="Leaves pe-tools"
          />
        </VerbGroup>

        <VerbGroup title="writes beyond the page" radius="document · model · external">
          <Verb
            tone="commit"
            label="save profile"
            icon={Save}
            onClick={noop}
            reason="Writes to the family profile"
          />
          <Verb
            tone="commit"
            label="apply to Revit"
            icon={Upload}
            onClick={noop}
            reason="Writes 42 parameters into the live model"
          />
          <Verb
            tone="commit"
            label="sync to .r10"
            icon={Share2}
            onClick={noop}
            disabled
            reason="no .r10 target bound — bind one in the sentence first"
          />
          <Verb
            tone="commit"
            label="applying"
            icon={Upload}
            busy
            onClick={noop}
            reason="In flight"
          />
        </VerbGroup>
      </div>

      <Cap>
        left to right: the refused verb keeps a shape, an edge and its reason; the busy verb is
        inert but says nothing about refusal — &ldquo;in flight&rdquo; is not a no.
      </Cap>

      <CounterExample why="all three writes wear the same blue however far they reach. Tinting by blast radius mints hues the reader must learn, and the group head already said it.">
        <span className="flex items-center gap-2">
          <Verb tone="commit" label="save profile" icon={Save} onClick={noop} reason="document" />
          <span className="dl-tag">…would need a second blue for model, a third for external</span>
        </span>
      </CounterExample>

      <GapNote>
        <code>busy</code> and <code>disabled</code> both render inert, and a busy verb that is ALSO
        refused cannot be expressed — the props compose but the surface has one state to show it
        with. No ruling exists; no slot was taken.
      </GapNote>
    </Demo>
  );
}

function ChipBlock() {
  const [narrowings, setNarrowings] = useState<readonly { label: string; count: number }[]>([
    { label: "needs a person", count: 3 },
    { label: "type: FDCL-611", count: 1 },
  ]);
  return (
    <Demo
      label="FactChip · NarrowChip"
      consumers="FactChip — ArmingStrip's plan hash and count (shipping), every fixture seam on this route and its satellites; NarrowChip — soon, the addressing sentence's narrowing row"
      spec={
        <>
          Two components, not two modes of one: round 1 proved a <em>narrowing control</em> cannot
          be built from a <em>state fact</em>, and merging them would give the fact chip an{" "}
          <code className="face-mono t-label">onRemove</code> nobody fills. Tone comes from the
          meaning tokens and a chip may not mint a hue. The dashed edge is reserved for one meaning
          — seam: typed but unproven.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <FactChip title="Neutral machine-measured fact. Most chips are this.">
          plan a91f#c04
        </FactChip>
        <FactChip tone="pea" title="Pea's own count of what it is proposing.">
          2 proposed
        </FactChip>
        <FactChip tone="caution" title="Unsaved work that will be lost if you leave.">
          2 unsaved
        </FactChip>
        <FactChip tone="done" title="Written and receipted.">
          42 written
        </FactChip>
        <FactChip tone="alarm" title="The model disagrees with 1 value on screen.">
          1 drift
        </FactChip>
        <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
          fixture
        </FactChip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {narrowings.map((n) => (
          <NarrowChip
            key={n.label}
            label={n.label}
            count={n.count}
            onRemove={() => setNarrowings((prev) => prev.filter((p) => p.label !== n.label))}
            title="Narrows the view. Removing it widens back out — it never reveals rows that were being concealed."
          />
        ))}
        {narrowings.length === 0 ? <Cap>nothing narrowing — every row in scope</Cap> : null}
      </div>

      <GapNote>
        a removed narrowing has no way back on this surface: <code>NarrowChip</code> owns removal,
        and nothing owns re-adding. That belongs to the addressing sentence, which has no component
        yet — so this demo can only be widened, never re-narrowed.
      </GapNote>
    </Demo>
  );
}

/* the state matrix: every prop combination the grammar rules on, on realistic rows. */
const CELL_MATRIX: readonly { row: ParamRow; says: string }[] = PARAM_ROWS.filter((r) =>
  [
    "fireRating",
    "sillHeight",
    "operatorType",
    "panelThickness",
    "frameDepth",
    "roughWidth",
    "headHeight",
    "mark",
    "zoneArea",
    "typeComments",
    "connectedLoad",
  ].includes(r.key),
).map((row) => ({
  row,
  says:
    {
      fireRating:
        "pea proposes — wash, ring, fold, and pea's square. Fold and square travel together.",
      sillHeight: "you staged — bold plus the caution square. Bold appears nowhere else, ever.",
      operatorType:
        "pea staged — the SAME square, pea's colour, no bold. Authorship is the colour.",
      panelThickness: "drift — the one alarm, plus the model's value as a struck inline ghost.",
      frameDepth: "stale read — squiggle rank 2.",
      roughWidth: "never read — squiggle rank 3, the quietest.",
      headHeight: "locked by a formula — greyed italic owns the body; no marks are permitted.",
      mark: "excluded by Revit — renders identically to readonly. Two refusals, one treatment.",
      zoneArea: "seam — nothing real behind it. The reserved dashed edge and nothing else.",
      typeComments: "a long value with a citation — the footline clamps to one line, always.",
      connectedLoad:
        "THE CRUCIBLE: proposed AND drift. The proposal owns the body, drift owns the squiggle slot, and both marks land.",
    }[row.key] ?? "",
}));

function StateCellBlock() {
  return (
    <Demo
      label="StateCell"
      consumers="master-table cells (§04 below, live); the chat proposal card and its table (/design-system/proposal-flow); CellStateKey, which renders its specimens through this component so the key cannot lie about the table; soon: the trichotomy reviewer"
      spec={
        <>
          The winner of round 1, and the reason there is a language at all: one grammar at any
          scale. Precedence runs{" "}
          <em>
            uneditable owns the body ▸ pea&apos;s proposal owns it otherwise ▸ the squiggle slot ▸
            unsaved composes on top ▸ citation never contends
          </em>
          , and it is enforced by cascade order in{" "}
          <code className="face-mono t-label">lang.css</code>, not by discipline in the caller.
          Icons never go inside a data cell — they break table ergonomics the moment a value runs
          long.
        </>
      }
    >
      <div className="flex flex-col">
        {CELL_MATRIX.map(({ row, says }) => (
          <div
            key={row.key}
            className="grid grid-cols-1 items-baseline gap-x-5 gap-y-1 border-b border-line py-2 last:border-b-0 sm:grid-cols-[8rem_minmax(0,22rem)_minmax(0,1fr)]"
          >
            <span className="face-mono t-caption text-ink-mute">{row.param}</span>
            <span className="min-w-0">
              <StateCell {...cellProps(row)} />
            </span>
            <span className="t-caption text-ink-2">{says}</span>
          </div>
        ))}
      </div>

      <CounterExample why="the weak anchor reserves the cell BODY for pea's proposal and for uneditable. A proposal on a locked cell is swallowed by precedence — correctly: a cell you cannot write cannot show a proposal you could accept. The caller gets no error, which is the finding.">
        <StateCell value="84 in" cap="readonly" capReason="driven by formula" stage="proposed" />
      </CounterExample>

      <GapNote>
        <code>stagedBy</code> exists because the RENDERING is ruled, but the state model has no
        author on <code>staged</code> — <code>trichotomy.ts</code> stores <code>by</code> and every
        consumer discards it, so production infers pea-vs-you from <code>origin</code>, which is the
        author of the VALUE. Both squares above are fixture-supplied; this is the round&apos;s
        strongest signal.
      </GapNote>
      <GapNote>
        <code>readonly</code> and <code>excluded</code> are two different refusals — a formula
        drives it · the model never bound it — and render as one greyed-italic body. The footline
        carries the difference in words; nothing carries it in marks. And &ldquo;typing beats
        proposing&rdquo; (severed) has no <code>stage</code> member at all and cannot be rendered.
      </GapNote>
    </Demo>
  );
}

function CellKeyBlock() {
  return (
    <Demo
      label="CellStateKey"
      consumers="any surface that mounts StateCell — mounted live inside the table's frame in §04; a first-class component since round-2 ruling note 2 promoted it out of legend-strip status"
      spec={
        <>
          Promoted to a component because it was instrumental to the table reading at all. Grouped{" "}
          <em>by axis</em>, ordered inside a group by the cell&apos;s own precedence — so the key
          cannot teach a ranking the cells do not obey. Every specimen is a real{" "}
          <code className="face-mono t-label">StateCell</code> with real props: a key drawn with its
          own markup can teach a treatment the table does not use, and eventually will.
        </>
      }
    >
      <div className="max-w-3xl border border-line">
        <CellStateKey />
      </div>
      <GapNote>
        the axes are a fixed list, not a subset derived from the rows on screen. A key beside a
        table with no drift in it still teaches drift. Deriving it needs the table to know what its
        cells ARE — see the renderer-identity gap in §04.
      </GapNote>
    </Demo>
  );
}

const OUTCOMES: readonly {
  kind: "busy" | "receipt" | "refused" | "dropped" | "advisory" | "partial" | "error";
  label: string;
  says: string;
}[] = [
  { kind: "busy", label: "applying… 3s", says: "in flight" },
  { kind: "receipt", label: "42 parameters written", says: "it landed" },
  {
    kind: "refused",
    label: "refused · plan hash drift",
    says: "declined before touching anything",
  },
  { kind: "dropped", label: "discarded — write already in flight", says: "it never happened" },
  { kind: "advisory", label: "2 types would be skipped", says: "a dry run blocks nothing" },
  {
    kind: "partial",
    label: "38 of 42 written · 4 staged",
    says: "the failures stay staged for retry",
  },
  { kind: "error", label: "bridge busy", says: "one of 7 host issue kinds" },
];

function OutcomeBlock() {
  return (
    <Demo
      label="OutcomeLine"
      consumers="the commit receipt on /design-system/proposal-flow; soon: the families and takeoffs receipt lanes"
      spec={
        <>
          Coloured mono text, one icon, one decoration. No left bars — round 1 measured that
          vertical bars were simply not understood. Every kind reuses a meaning role already in the
          contract, and two of those are arguments rather than conveniences: a plan-hash{" "}
          <em>refusal</em> is the model disagreeing, so it earns the one alarm; an <em>error</em> is
          a busy bridge, which is not, so it takes caution. Never bold.
        </>
      }
    >
      <div className="flex flex-col">
        {OUTCOMES.map((o) => (
          <OutcomeLine key={o.kind} kind={o.kind} label={o.label} says={o.says} />
        ))}
      </div>
      <Cap>
        an outcomes lane is plain content — it reports on a machine-operated object, it is not one.
        Never framed.
      </Cap>
      <GapNote>
        an outcome carries no verb, no time, no target and no item list. &ldquo;4 staged for
        retry&rdquo; has nowhere for the 4 to live, and a lane of these cannot say which write
        produced which receipt. Outcomes are orphans; the state model moves first, then the
        signature.
      </GapNote>
    </Demo>
  );
}

function ArmingBlock() {
  return (
    <Demo
      label="ArmingStrip"
      consumers="none yet. The family apply verb is the intended first consumer; the lifecycle is driven live at /design-system/arming"
      spec={
        <>
          The cell grammar at its largest scale, and the ceremony clause SURFACE-PHILOSOPHY §3 has
          been owed since the honesty rules were written: reason supplied before it arms, explicit
          target, plan hash, drift refusal, receipt. Only variant e&apos;s strip read as ceremony
          rather than &ldquo;just another component&rdquo;, and the round attributed that to border
          scarcity — a tinted ground plus one edge, doing what an outline box could not.
        </>
      }
    >
      <p className="t-prose max-w-[76ch] text-ink-2">
        The strip is a lifecycle, not a specimen: unarmed → armed → refused → re-plan. Freezing one
        frame here would teach the shape and hide the mechanism, which is exactly the mistake the
        round-1 fixture made. All three phases and one live instance are at{" "}
        <Link to="/design-system/arming" className="text-nav hover:underline">
          /design-system/arming
        </Link>
        .
      </p>
      <GapNote>
        arming has no lifecycle or identity in the state model — no armed-at, no armed-by, no link
        from the verb it arms, and no link from a refusal to a fresh plan hash. The consequence is
        on the surface rather than hidden: the strip renders &ldquo;armed against a plan of unknown
        age&rdquo;, which is the one fact that decides whether to press it.
      </GapNote>
    </Demo>
  );
}

/* ═══ 05 · the real table ═══════════════════════════════════════════════════════════════════
   THE INTEGRATION THE PROTOTYPE COULD NOT DO. `MasterTable` is the primitive atlas/takeoffs and
   families actually run on; `StateCell` is the grammar. Until this section existed, nothing had
   ever put them in the same DOM, and every claim that the language "works in the table" was an
   assertion about a hand-rolled table that shares no code with the product.

   The rule for this section: MasterTable IS NOT FORKED, WRAPPED, OR RESTYLED to make the picture
   come out. Where its contract cannot express something the grammar needs, there is a `GAP:` here
   and a visible gap-note below. The gap is the deliverable. */

function RealTable() {
  const columns = useMemo<Column<ParamRow>[]>(
    () => [
      {
        key: "param",
        label: "parameter",
        title: "The parameter as Revit names it.",
        width: "w-44",
        lock: true,
        sort: (r) => r.param,
        search: (r) => r.param,
        // GAP (MasterTable): `td` is `p-0` and `Column` has no cell-class hook — only
        // `headerClassName`, `width` and `right`. Every renderer must draw its own box model, so
        // cell padding is decided thirteen times per table instead of once by the primitive.
        cell: (r) => <span className="block px-1.5 py-1">{r.param}</span>,
      },
      {
        key: "scope",
        label: "scope",
        title: "Type-level or instance-level.",
        width: "w-24",
        facet: (r) => r.scope,
        cell: (r) => (
          <span className="face-mono t-caption block px-1.5 py-1 text-ink-2">{r.scope}</span>
        ),
      },
      {
        key: "value",
        label: "value",
        title:
          "The value, carrying every mark the grammar has to make. Its filter speaks the grammar's own state vocabulary.",
        // THE CELL-STATE CLAUSE (ruled 2026-08-16, discharging the renderer-identity gap): the
        // column declares WHAT IT DRAWS. The table renders StateCell itself, and facet defaults
        // to the grammar's one-word reading — the hand-modelled `state` column this section
        // used to carry is gone because the primitive now reads the cell instead of the caller
        // restating it. Sort stays the VALUE; the filter carries the state.
        state: cellProps,
        sort: (r) => r.value,
        search: (r) => r.value,
      },
      {
        key: "read",
        label: "last read",
        title: "How old the reading behind the value is.",
        width: "w-24",
        right: true,
        sort: (r) => r.ageMin ?? Number.MAX_SAFE_INTEGER,
        cell: (r) => (
          <span className="face-mono t-caption block px-1.5 py-1 text-ink-2">{ageText(r)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <Section
      n="04"
      title="the real table"
      note="the actual MasterTable — the primitive atlas, takeoffs and families run on — with StateCell as its cell renderer"
      help="The product table primitive, unmodified, with the cell grammar as its renderer. Rows never grow; click a cell and the readout band under the table speaks its facts. The gap notes below are the section's deliverable."
    >
      <p className="t-prose max-w-[80ch] text-ink-2">
        The design-lang round hand-rolled its table, so the grammar was only ever proven against
        markup written to flatter it. This is the product primitive, unmodified, wrapped in an{" "}
        <code className="face-mono t-label">ArtifactFrame</code> per the border budget, with the
        cell-state key inside the frame it describes. Sort a column, filter one, type in the search
        box — the grammar has to survive all of it. THE ROW LAW (ruled 2026-08-16): a cell is one
        clipped line — the value and its zero-footprint marks, with the body wash filling the whole
        cell. Fat rows are never allowed. The prose a cell used to carry (refusal reasons, notes,
        citations, the model&apos;s ghost value) reads out in the band under the table when the cell
        is focused, the way a spreadsheet&apos;s formula bar reads out the active cell — click a
        cell below to see it.
      </p>
      <p className="t-prose max-w-[80ch] text-ink-2">
        This table is also the exhibit for two of §01&apos;s laws, because neither can be shown on a
        static specimen. <strong>A filter&apos;s vocabulary is stable under filtering:</strong> the
        facet options come from <code className="face-mono t-label">facetOptions</code> reading ALL
        rows, never the visible subset, so narrowing by scope leaves the value column&apos;s state
        vocabulary untouched and picking an option can always widen back out — at the price of a
        chosen option resolving to zero visible rows, which the empty state says.{" "}
        <strong>Sort by domain order:</strong> a <code className="face-mono t-label">state</code>{" "}
        column that declares no <code className="face-mono t-label">sort</code> falls back to{" "}
        <code className="face-mono t-label">CELL_STATE_ORDER</code> — drift first, locked last —
        rather than to the alphabet. The value column below opts out deliberately: it sorts by the
        VALUE and lets its facet carry the state.
      </p>

      <ArtifactFrame
        head={
          <>
            <span className="dl-tag">overhead coiling door 421 · parameters</span>
            <FactChip title="Rows in scope before any narrowing.">
              {PARAM_ROWS.length} params
            </FactChip>
            <FactChip tone="alarm" title="Values the model disagrees with.">
              2 drift
            </FactChip>
            <FactChip tone="caution" title="Unsaved work that will be lost if you leave.">
              2 unsaved
            </FactChip>
            <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
              fixture
            </FactChip>
          </>
        }
        foot={
          <>
            <span className="dl-tag">2 unsaved · 1 refused by Revit</span>
            <Verb
              tone="commit"
              label="apply to Revit"
              icon={Upload}
              onClick={noop}
              disabled
              reason="fixture data — there is no model behind this table to write to"
            />
          </>
        }
      >
        {/* MasterTable is `flex min-h-0 flex-1 flex-col` internally and expects a bounded parent. */}
        <div className="flex h-[26rem] flex-col">
          <MasterTable
            rows={PARAM_ROWS}
            columns={columns}
            rowKey={(r) => r.key}
            scopeLabel="params in scope"
            searchPlaceholder="search params…"
            summary={<>13 params · 3 types</>}
            // THE OWED MARKER (ruled 2026-08-16, fit reviews): the gutter locates the rows a
            // person must act on — count in the tone's ink, sentence in the title, no verb.
            // The locked param column offsets past it, which is the lock interaction the prop
            // documents, exercised here on purpose.
            gutter={(r) =>
              r.agree === "drift"
                ? {
                    count: 1,
                    title: "the model disagrees — a person must pick the real value",
                    tone: "alarm",
                  }
                : r.stage === "staged"
                  ? { count: 1, title: "staged and unsaved — commit or discard before leaving" }
                  : null
            }
          />
        </div>
        {/* GAP (ArtifactFrame): the key belongs "inside the frame of the thing it describes", and
            the only place it fits is last-child-by-authorship. The `foot` slot is a flex control
            bar; a full-width grid block cannot go in it. */}
        <CellStateKey />
      </ArtifactFrame>

      <div className="flex flex-col gap-1.5 pt-1">
        <span className="t-caption t-upper text-ink">what MasterTable cannot express</span>
        <GapNote>
          <strong>the clause&apos;s residue.</strong> The cell-state clause (ruled 2026-08-16)
          discharged renderer identity, selection-as-hue, the hover law and the two-palette chrome —
          but <code>CellStateKey</code> still cannot derive its axes from the rows on screen, and a
          row holding a proposal is still marked through <code>rowClassName</code>, which knows
          nothing about the grammar. Row-level state is the clause&apos;s unfinished half.
        </GapNote>
        <GapNote>
          <strong>non-state cells own their own box.</strong> <code>td</code> is <code>p-0</code>;
          the table draws the box model for <code>state</code> columns, but every plain{" "}
          <code>cell</code> renderer still decides padding for itself — decided per column instead
          of once by the primitive.
        </GapNote>
        <GapNote>
          <strong>two heads.</strong> <code>scopeLabel</code> is required and MasterTable always
          draws its own scope/search/chip strip, so the artifact frame&apos;s head band and the
          table&apos;s head band stack. There is no way to hand the frame the scope label instead.
        </GapNote>
        <GapNote>
          <strong>one chip family now.</strong> The strip&apos;s chips ARE <code>NarrowChip</code>{" "}
          (fit reviews, ruled 2026-08-16 — <code>FilterChip</code> deleted). The honest residue: the
          strip has no per-narrowing denominator, so every chip&apos;s count is rows still in scope
          under ALL active narrowings, not what this one alone admits.
        </GapNote>
        <GapNote>
          <strong>no footline row.</strong> A receipt has nowhere in the grid: outcomes can only sit
          in the frame foot, outside the columns, so a partial write cannot align its &ldquo;4
          staged&rdquo; to the four rows it means.
        </GapNote>
      </div>
    </Section>
  );
}

/* ═══ 06 · satellites ═══════════════════════════════════════════════════════════════════════ */

const SATELLITES: readonly { to: string; name: string; purpose: string }[] = [
  {
    to: "/design-system/proposal-flow",
    name: "proposal flow",
    purpose:
      "one shared in-memory world behind pea's chat card AND a StateCell table — accept, deny or undo in the card and the same value moves in the table. The proof that one grammar at two scales is a mechanism and not a resemblance. Carries the two-marks crucible and a commit receipt.",
  },
  {
    to: "/design-system/arming",
    name: "arming",
    purpose:
      "the ArmingStrip lifecycle driven live: type a reason to arm it, commit, take a simulated drift refusal, re-plan. All three phases also stand frozen side by side, because a lifecycle you have to perform to see is a lifecycle nobody reviews.",
  },
  {
    to: "/design-system/popovers",
    name: "popovers",
    purpose:
      "the position harness. Every popover-bearing component the app actually ships, mounted nine times at the corners, edges and centre of the viewport. It does not fix flip/clamp/overflow inconsistency — it makes it one visible fact, which is what queues a single popover foundation.",
  },
  {
    to: "/design-system/swatch",
    name: "swatch",
    purpose:
      "fast lookup — every component in lang/ and the surviving ui/, alphabetical, with its import path on the surface, its grep-derived consumer count, and its whole variant × state grid rendered small. The spec lives here; the swatch is where you FIND the component you are about to change.",
  },
];

function Satellites() {
  return (
    <Section
      n="05"
      title="satellites"
      note="mocked complicated cases — sibling routes, not nested; each announces its fixture with a dashed seam"
    >
      <div className="flex flex-col">
        {SATELLITES.map((s) => (
          <div
            key={s.to}
            className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
          >
            <Link to={s.to} className="t-value text-nav hover:underline">
              {s.name}
              <span className="face-mono t-caption ml-2 text-ink-mute">{s.to}</span>
            </Link>
            <p className="t-value text-ink-2">{s.purpose}</p>
          </div>
        ))}
      </div>
      <p className="t-label max-w-[80ch] text-ink-mute">
        Satellites mock their worlds by construction — null identities, no host calls — and say so
        on the surface. That requirement closes only if a satellite is ever promoted to a real
        route.
      </p>
    </Section>
  );
}
