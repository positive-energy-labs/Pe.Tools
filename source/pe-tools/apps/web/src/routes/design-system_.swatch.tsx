/**
 * /design-system/swatch — SATELLITE. THE LOOKUP TABLE.
 *
 * WHY (ruled 2026-08-16, kaitpw): "I miss having the swatch of all my components on a single
 * screen — somewhere I can see the render, understand all the variants/states, and then easily
 * find the code. If I'm iterating on the dropdown styling, I find it in the swatch, where I know
 * it'll be, rather than in a demo route."
 *
 * THE DIVISION OF LABOUR: `/design-system` is the SPEC — the laws, the reasoning, the gaps, the
 * counter-examples. This page states none of it. It is a lookup: one compact block per component,
 * alphabetical inside two groups, carrying the import path as selectable text and the whole
 * variant × state surface rendered small. Captions are prop values, not sentences. If a ruling
 * belongs anywhere it belongs on the index; duplicating it here would give the language two
 * places to drift apart.
 *
 * CONSUMER COUNTS are grep-derived on the date shown beside them (`components/<group>/<file>`
 * imported from outside its own directory). They are a snapshot, stated as one, and the number is
 * what tells you whether the component you are about to restyle has one caller or twenty-two.
 *
 * FIXTURE, ANNOUNCED: `design-system/fixtures.ts` — the same rows the index and the other
 * satellites render, so no surface here can show a cell state the table cannot.
 */
import { Fragment, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronsDownUp, RefreshCw, Save, Search, Sparkles, Upload } from "lucide-react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { ArmingStrip } from "#/components/lang/arming-strip";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CELL_STATE_ORDER, StateCell, cellStateLabel } from "#/components/lang/cell";
import type { StateCellProps } from "#/components/lang/cell";
import { CellStateKey } from "#/components/lang/cell-key";
import { FactChip, NarrowChip, type FactTone, Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { Badge } from "#/components/ui/badge";
import { Press } from "#/components/lang/press";
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
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "#/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import { Pane } from "#/components/ui/pane";
import { PickList } from "#/components/ui/pick-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { SidePane } from "#/components/ui/side-pane";
import { Switch } from "#/components/ui/switch";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { CoverageBar } from "#/components/lang/coverage-bar";
import { EmptyState } from "#/components/lang/empty";
import { Provenance, Section } from "#/components/lang/section";
import { Switcher } from "#/components/lang/switcher";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { ValueDiff } from "#/components/ui/value-diff";
import { ARMING_FIXTURE, CATEGORY_OPTIONS, PARAM_ROWS, cellProps } from "#/design-system/fixtures";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/design-system_/swatch")({ component: Swatch });

const noop = () => {};

/* ═══ page chrome ═══════════════════════════════════════════════════════════════════════════ */

/** One component. Identity on the left — name, import path, consumer count — specimens right. */
function Block({
  group,
  file,
  name,
  consumers,
  children,
}: {
  group: "lang" | "ui";
  /** The file, which is also the import path's last segment and this block's anchor. */
  file: string;
  /** The exported names, as you would write them in an import. */
  name: string;
  consumers: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`${group}-${file}`}
      className="grid scroll-mt-14 grid-cols-1 items-start gap-x-6 gap-y-2 border-b border-line py-3.5 last:border-b-0 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="face-mono t-label text-ink">{name}</span>
        {/* `code` is display:block app-wide; `w-fit` keeps the path a token you select, not a band. */}
        <code className="w-fit face-mono t-caption break-all text-ink-2 select-all">
          #/components/{group}/{file}
        </code>
        <span className="face-mono t-caption text-ink-mute">{consumers}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A lane of specimens. */
function Lane({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-x-5 gap-y-3", className)}>{children}</div>
  );
}

/** One specimen under its prop values. The caption IS the props — no prose. */
function Spec({
  cap,
  children,
  className,
}: {
  cap: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <div className="flex min-h-6 items-center">{children}</div>
      <span className="face-mono t-caption whitespace-nowrap text-ink-mute">{cap}</span>
    </div>
  );
}

/** A two-axis specimen grid — the shape a variant × state surface actually has. */
function Grid<R extends string, C extends string>({
  rows,
  cols,
  cell,
}: {
  rows: readonly R[];
  cols: readonly C[];
  cell: (row: R, col: C) => React.ReactNode;
}) {
  return (
    <div
      className="inline-grid items-center gap-x-4 gap-y-1.5"
      style={{ gridTemplateColumns: `auto repeat(${cols.length}, auto)` }}
    >
      <span />
      {cols.map((c) => (
        <span key={c} className="face-mono t-caption text-ink-mute">
          {c}
        </span>
      ))}
      {rows.map((r) => (
        <Fragment key={r}>
          <span className="face-mono t-caption whitespace-nowrap text-ink-mute">{r}</span>
          {cols.map((c) => (
            <span key={c} className="flex min-w-0 items-center">
              {cell(r, c)}
            </span>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** What a frozen specimen cannot show. One line, mono, never a paragraph. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="face-mono t-caption text-ink-mute">{children}</p>;
}

/** A minimal bound around a component that fills its container. */
function Bound({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("border border-line", className)}>{children}</div>;
}

/* ═══ the roster ════════════════════════════════════════════════════════════════════════════ */

const LANG_FILES = [
  "addressing-bar",
  "arming-strip",
  "artifact-frame",
  "cell",
  "cell-key",
  "chip",
  "coverage-bar",
  "empty",
  "help",
  "outcome",
  "section",
  "switcher",
  "verb",
] as const;

/** Only files with a live consumer. `ui/chip` fell to zero and `ui/verb` was deleted outright
 *  when family/ absorbed the lang components (2026-08-16) — a swatch that keeps rendering a
 *  component nothing imports is how the old exhibit got to 1,540 lines. */
const UI_FILES = [
  "badge",
  "button",
  "card",
  "combobox",
  "command",
  "dialog",
  "input",
  "input-group",
  "label",
  "pane",
  "pick-list",
  "select",
  "side-pane",
  "switch",
  "textarea",
  "toggle-group",
  "value-diff",
] as const;

function Jump({ group, files }: { group: "lang" | "ui"; files: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="t-caption t-upper text-ink">{group}</span>
      {files.map((f) => (
        <a key={f} href={`#${group}-${f}`} className="face-mono t-caption text-nav hover:underline">
          {f}
        </a>
      ))}
    </div>
  );
}

/* ═══ the page ══════════════════════════════════════════════════════════════════════════════ */

function Swatch() {
  return (
    <div className="min-h-screen bg-page t-prose text-ink">
      <header className="sticky top-0 z-sticky border-b border-line bg-page/90 backdrop-blur">
        <div className="page-wrap flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system" className="t-label text-nav hover:underline">
              ← design system
            </Link>
            <span className="t-title face-display">swatch</span>
            <span className="truncate t-label text-ink-2">
              every component · every variant · every state · the import path
            </span>
            <FactChip
              dashed
              title="Every row rendered here is fixture data — no host, no document."
            >
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="page-wrap flex flex-col gap-8 pt-6 pb-24">
        <div className="flex flex-col gap-3">
          <p className="t-head face-display">The swatch.</p>
          <p className="max-w-[80ch] t-prose text-ink-2">
            A lookup table, not a spec: find the component, read its whole variant × state surface
            at once, copy the import path — the rulings behind any of it live on{" "}
            <Link to="/design-system" className="text-nav hover:underline">
              /design-system
            </Link>
            .
          </p>
          <div className="flex flex-col gap-1.5 border-y border-line py-2">
            <Jump group="lang" files={LANG_FILES} />
            <Jump group="ui" files={UI_FILES} />
          </div>
        </div>

        <LangGroup />
        <UiGroup />
      </main>
    </div>
  );
}

function GroupHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-1.5">
      <span className="t-label t-upper">{title}</span>
      <span className="min-w-0 flex-1 t-label text-ink-2">{note}</span>
    </div>
  );
}

/* ═══ lang ══════════════════════════════════════════════════════════════════════════════════ */

/** One fixture row per state word, read through the SHIPPING label function — so the swatch
 *  cannot show a state the table would classify differently. */
const CELL_BY_STATE = CELL_STATE_ORDER.flatMap((state) => {
  const props = PARAM_ROWS.map(cellProps).filter((p) => cellStateLabel(p) === state);
  return props.length > 0 ? [{ state, props: props[0] as StateCellProps }] : [];
});

/** The prop combinations the state word alone does not distinguish. */
const CELL_EXTRA_CAPS: Record<string, string> = {
  operatorType: "stage=staged · stagedBy=pea",
  zoneArea: "cap=nohome",
  typeComments: "grounding · long value",
  connectedLoad: "stage=proposed + agree=drift",
};

const CELL_EXTRAS = ["operatorType", "zoneArea", "typeComments", "connectedLoad"].flatMap((k) =>
  PARAM_ROWS.filter((r) => r.key === k),
);

const FACT_TONES: readonly FactTone[] = ["meta", "caution", "done", "alarm", "pea"];

const OUTCOME_SPECS: readonly { kind: OutcomeKind; label: string }[] = [
  { kind: "busy", label: "applying… 3s" },
  { kind: "receipt", label: "42 parameters written" },
  { kind: "refused", label: "refused · plan hash drift" },
  { kind: "dropped", label: "discarded — write in flight" },
  { kind: "advisory", label: "2 types would be skipped" },
  { kind: "partial", label: "38 of 42 written · 4 staged" },
  { kind: "error", label: "bridge busy" },
];

interface VerbFlags {
  disabled?: boolean;
  busy?: boolean;
  reason: string;
}

const VERB_STATES = ["enabled", "disabled", "busy"] as const;
type VerbState = (typeof VERB_STATES)[number];

const VERB_ROWS = ["act", "agent", "commit", "nav · back", "nav · forward", "nav · out"] as const;
type VerbRow = (typeof VERB_ROWS)[number];

const VERB_MAKERS: Record<VerbRow, (f: VerbFlags) => React.ReactNode> = {
  act: (f) => <Verb label="collapse" icon={ChevronsDownUp} onClick={noop} {...f} />,
  agent: (f) => <Verb tone="agent" label="ask pea" icon={Sparkles} onClick={noop} {...f} />,
  commit: (f) => <Verb tone="commit" label="apply" icon={Upload} onClick={noop} {...f} />,
  "nav · back": (f) => <Verb tone="nav" direction="back" label="all types" onClick={noop} {...f} />,
  "nav · forward": (f) => (
    <Verb tone="nav" direction="forward" label="open" onClick={noop} {...f} />
  ),
  "nav · out": (f) => <Verb tone="nav" direction="out" label="RHVAC" onClick={noop} {...f} />,
};

function verbFlags(state: VerbState): VerbFlags {
  if (state === "disabled") return { disabled: true, reason: "no target bound" };
  if (state === "busy") return { busy: true, reason: "In flight" };
  return { reason: "What pressing this does" };
}

function LangGroup() {
  return (
    <section className="flex flex-col gap-3">
      <GroupHead
        title="lang"
        note="the design language itself — every component here runs on --pe-* tokens only"
      />

      <Block
        group="lang"
        file="addressing-bar"
        name="AddressingBar"
        consumers="1 consumer — family/workspace (the head the shape was proven on); families + takeoffs adopt in their route passes"
      >
        <Bound className="w-full max-w-2xl">
          <AddressingBar
            name="family"
            sentence={<span>editing profiles/door.pea.json</span>}
            facts={
              <FactChip tone="caution" title="Unsaved draft — two edits not on disk.">
                unsaved draft · 2
              </FactChip>
            }
            verb={
              <Verb
                tone="commit"
                label="save profile"
                onClick={noop}
                reason="Writes the profile back to disk"
              />
            }
            seam={
              <FactChip
                dashed
                title="Fixture lane — the swatch mounts no Sentence; the real consumer wires components/sentence here."
              >
                fixture
              </FactChip>
            }
          />
        </Bound>
        <Note>
          the five-slot rule: name · sentence · facts · the one page-blast verb · seam,
          right-aligned. A verb that acts on one pane belongs in that pane&apos;s strip.
        </Note>
      </Block>

      <Block
        group="lang"
        file="arming-strip"
        name="ArmingStrip"
        consumers="1 consumer — routes/design-system_.arming"
      >
        <Lane className="items-stretch">
          <Spec cap='reason="" → unarmed' className="w-full max-w-[26rem]">
            <ArmingStrip
              verb={ARMING_FIXTURE.verb}
              target={ARMING_FIXTURE.target}
              count={ARMING_FIXTURE.count}
              planHash={ARMING_FIXTURE.planHash}
              reason=""
              onReasonChange={noop}
              state={{ phase: "arming" }}
              onCommit={noop}
              onCancel={noop}
            />
          </Spec>
          <Spec cap="reason supplied → armed" className="w-full max-w-[26rem]">
            <ArmingStrip
              verb={ARMING_FIXTURE.verb}
              target={ARMING_FIXTURE.target}
              count={ARMING_FIXTURE.count}
              planHash={ARMING_FIXTURE.planHash}
              reason={ARMING_FIXTURE.reasonExample}
              onReasonChange={noop}
              state={{ phase: "arming" }}
              onCommit={noop}
              onCancel={noop}
            />
          </Spec>
          <Spec cap="state.phase=refused" className="w-full max-w-[26rem]">
            <ArmingStrip
              verb={ARMING_FIXTURE.verb}
              target={ARMING_FIXTURE.target}
              count={ARMING_FIXTURE.count}
              planHash={ARMING_FIXTURE.planHash}
              reason={ARMING_FIXTURE.reasonExample}
              onReasonChange={noop}
              state={{ phase: "refused", refusal: ARMING_FIXTURE.refusal, onReplan: noop }}
              onCommit={noop}
              onCancel={noop}
            />
          </Spec>
        </Lane>
        <Note>
          frozen — the reason input is inert here. The lifecycle runs live at /design-system/arming.
        </Note>
      </Block>

      <Block
        group="lang"
        file="artifact-frame"
        name="ArtifactFrame"
        consumers="2 consumers — design-system, design-system_.proposal-flow"
      >
        <Lane className="items-stretch">
          <Spec cap="children only" className="w-52">
            <ArtifactFrame>
              <div className="px-2.5 py-2">
                <StateCell value="24 in" />
              </div>
            </ArtifactFrame>
          </Spec>
          <Spec cap="head" className="w-52">
            <ArtifactFrame head={<Tag>door 421</Tag>}>
              <div className="px-2.5 py-2">
                <StateCell value="2 hr" stage="proposed" />
              </div>
            </ArtifactFrame>
          </Spec>
          <Spec cap="head + foot" className="w-52">
            <ArtifactFrame
              head={<Tag>door 421</Tag>}
              foot={
                <>
                  <Tag>2 unsaved</Tag>
                  <Verb
                    tone="commit"
                    label="save"
                    icon={Save}
                    onClick={noop}
                    reason="Writes both staged values"
                  />
                </>
              }
            >
              <div className="px-2.5 py-2">
                <StateCell value="36 in" stage="staged" />
              </div>
            </ArtifactFrame>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="lang"
        file="cell"
        name="StateCell · CELL_STATE_ORDER · cellStateLabel · cellFactsText · parseCell · fmtNum"
        consumers="7 consumers — master-table (×3; its Text/Number cells are StateCell wrappers since 2026-08-16), fixtures, design-system, proposal-flow, takeoff/atlas"
      >
        <Lane>
          {CELL_BY_STATE.map(({ state, props }) => (
            <Spec key={`card-${state}`} cap={`${state} · scale=card`}>
              <StateCell {...props} />
            </Spec>
          ))}
        </Lane>
        <Lane>
          {CELL_BY_STATE.map(({ state, props }) => (
            <Spec key={`row-${state}`} cap={`${state} · scale=row`}>
              <Bound className="w-24">
                <StateCell {...props} scale="row" />
              </Bound>
            </Spec>
          ))}
        </Lane>
        <Lane>
          {CELL_EXTRAS.map((r) => (
            <Spec key={r.key} cap={CELL_EXTRA_CAPS[r.key] ?? r.key} className="max-w-[19rem]">
              <span className="block w-[19rem] max-w-full">
                <StateCell {...cellProps(r)} />
              </span>
            </Spec>
          ))}
        </Lane>
        <Lane>
          <Spec cap="onCommit · non-number refuses, restores, and says why">
            <Bound className="w-40">
              <EditableCellSpec />
            </Bound>
          </Spec>
          <Spec cap="numeric={{ min: 0, digits: 1 }} · the built-in parse refusal">
            <Bound className="w-40">
              <NumericCellSpec />
            </Bound>
          </Spec>
        </Lane>
        <Note>
          row scale is full-bleed and sized by its container — the boxes above are the bound a table
          column supplies. Its facts read out via title, not a footline.
        </Note>
      </Block>

      <Block
        group="lang"
        file="cell-key"
        name="CellStateKey"
        consumers="2 consumers — design-system, design-system_.proposal-flow"
      >
        <Bound className="max-w-3xl">
          <CellStateKey />
        </Bound>
      </Block>

      <Block
        group="lang"
        file="chip"
        name="FactChip · NarrowChip"
        consumers="9 consumers — family/workspace, design-system (×4 routes), families, takeoffs, takeoff/atlas, master-table (NarrowChip is its filter strip — FilterChip deleted 2026-08-16)"
      >
        <Lane>
          {FACT_TONES.map((tone) => (
            <Spec key={tone} cap={`tone=${tone}`}>
              <FactChip tone={tone} title={`tone=${tone}`}>
                42 written
              </FactChip>
            </Spec>
          ))}
        </Lane>
        <Lane>
          {FACT_TONES.map((tone) => (
            <Spec key={tone} cap={`tone=${tone} · dashed`}>
              <FactChip tone={tone} dashed title={`tone=${tone} · dashed`}>
                42 written
              </FactChip>
            </Spec>
          ))}
        </Lane>
        <NarrowChipSpec />
      </Block>

      <Block
        group="lang"
        file="coverage-bar"
        name="CoverageBar"
        consumers="promoted for the ops pass 2026-08-16 — src/ops glance views migrate here; THE viz ladder's first catalogued consumer"
      >
        <div className="w-full max-w-md">
          <CoverageBar
            segments={[
              { label: "grounded", count: 34, viz: 2 },
              { label: "staged", count: 11, viz: 1 },
              { label: "unread", count: 6, viz: 6 },
            ]}
            total={60}
          />
        </div>
        <Note>
          segments spend --viz-N by index (never a meaning role); width + legend carry the meaning —
          the grayscale law. Empty denominators render nothing: the caller owns its EmptyState
          because only it knows the exit.
        </Note>
      </Block>

      <Block
        group="lang"
        file="empty"
        name="EmptyState"
        consumers="promoted 2026-08-16 (R9) — ~24 EMPTY_CLASS sites across families, family, takeoffs migrate onto it"
      >
        <Lane>
          <Spec cap='story="scope" · exit required'>
            <EmptyState story="scope" exit="run capture on this level to detect rooms">
              no zones on this level
            </EmptyState>
          </Spec>
          <Spec cap='story="filter"'>
            <EmptyState story="filter" exit="clear the room-state chip to widen back out">
              0 of 124 rooms match
            </EmptyState>
          </Spec>
        </Lane>
      </Block>

      <Block group="lang" file="help" name="HelpTip" consumers="1 consumer — design-system">
        <Lane>
          <Spec cap="children">
            <HelpTip>What this region is and how to think about it.</HelpTip>
          </Spec>
        </Lane>
        <Note>the popup is a CSS hover/focus reveal — hover the mark to see it.</Note>
      </Block>

      <Block
        group="lang"
        file="outcome"
        name="OutcomeLine"
        consumers="8 consumers — family/doc-pane, family/workspace, design-system (×3 routes), families, takeoffs, takeoff/atlas"
      >
        <div className="flex flex-col">
          {OUTCOME_SPECS.map((o) => (
            <div key={o.kind} className="flex items-baseline gap-3">
              <span className="face-mono t-caption w-16 shrink-0 text-ink-mute">{o.kind}</span>
              <OutcomeLine kind={o.kind} label={o.label} />
            </div>
          ))}
        </div>
      </Block>

      <Block
        group="lang"
        file="section"
        name="Section · Provenance"
        consumers="promoted for the ops pass 2026-08-16 — 44 OpSection + 80+ Provenance/MonoNote sites in src/ops migrate here; route section heads shed their hand-rolled copies in their passes"
      >
        <div className="w-full max-w-md">
          <Section
            label="loaded families"
            help={<HelpTip>What this section shows and how to read it.</HelpTip>}
            aside={<FactChip title="Rows currently in scope.">214 rows</FactChip>}
          >
            <p className="t-label text-ink-2">section content sits unenclosed.</p>
            <Provenance>read 2026-08-16 14:02 · 3 sessions · sheets truncated at 10</Provenance>
          </Section>
        </div>
      </Block>

      <Block
        group="lang"
        file="switcher"
        name="Switcher"
        consumers="3 consumers — family/doc-pane, family/workspace, this page · promoted from ui/ 2026-08-16 (R10)"
      >
        <Lane>
          <Spec cap="options · one disabled">
            <SwitcherSpec />
          </Spec>
        </Lane>
      </Block>

      <Block
        group="lang"
        file="verb"
        name="Verb · VerbGroup"
        consumers="8 consumers — family/doc-pane, family/workspace, design-system (×3 routes), families, takeoffs, takeoff/atlas"
      >
        <Grid
          rows={VERB_ROWS}
          cols={VERB_STATES}
          cell={(row, col) => VERB_MAKERS[row](verbFlags(col))}
        />
        <Lane>
          <Spec cap="VerbGroup · title + radius">
            <VerbGroup title="writes beyond the page" radius="document · model · external">
              <Verb
                tone="commit"
                label="save profile"
                icon={Save}
                onClick={noop}
                reason="Writes to the family profile"
              />
              <Verb label="refresh" icon={RefreshCw} onClick={noop} reason="Re-reads the model" />
            </VerbGroup>
          </Spec>
        </Lane>
        <Note>
          hover and :focus-visible take the one 10% ink veil and cannot be frozen — hover a specimen
          above. A disabled COMMIT verb renders its reason visibly beside the verb (fit reviews,
          2026-08-16); every other tone keeps the reason in the title.
        </Note>
      </Block>
    </section>
  );
}

function NarrowChipSpec() {
  const seed = [
    { label: "needs a person", count: 3 },
    { label: "type: FDCL-611", count: 1 },
  ];
  const [narrowings, setNarrowings] = useState(seed);
  return (
    <Lane>
      {narrowings.map((n) => (
        <Spec key={n.label} cap="NarrowChip · label + count">
          <NarrowChip
            label={n.label}
            count={n.count}
            onRemove={() => setNarrowings((prev) => prev.filter((p) => p.label !== n.label))}
            title="Narrows the view. Removing it widens back out."
          />
        </Spec>
      ))}
      {narrowings.length < seed.length ? (
        <Spec cap="restore the removed">
          <Verb
            label="restore"
            icon={RefreshCw}
            onClick={() => setNarrowings(seed)}
            reason="Puts the removed narrowings back"
          />
        </Spec>
      ) : null}
    </Lane>
  );
}

/* ═══ ui ════════════════════════════════════════════════════════════════════════════════════ */

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "blue",
  "green",
  "slate",
  "lichen",
  "clay",
  "kiln",
] as const;

/** The shape the exhibit's own trigger/action specimens wear. */
const SPEC_PRESS =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md border border-line px-2 t-value font-medium whitespace-nowrap text-ink transition-all hover:veil";

const PANE_KINDS = ["navigation", "visual", "content", "inspector"] as const;

const PICK_ITEMS = CATEGORY_OPTIONS.slice(0, 6).map((o, i) => ({
  id: o.value,
  label: o.label,
  group: i < 3 ? "openings" : "systems",
  meta: `${(i + 1) * 4}`,
}));

function UiGroup() {
  return (
    <section className="flex flex-col gap-3">
      <GroupHead
        title="ui"
        note="the surviving shadcn layer — every file below has a live consumer; the evicted exhibit pieces are gone, not moved"
      />

      <Block
        group="ui"
        file="badge"
        name="Badge · badgeVariants"
        consumers="1 consumer — routes/schedule-grid"
      >
        <Lane>
          {BADGE_VARIANTS.map((v) => (
            <Spec key={v} cap={`variant=${v}`}>
              <Badge variant={v}>doors</Badge>
            </Spec>
          ))}
        </Lane>
      </Block>

      <Block
        group="lang"
        file="press"
        name="Press — the machinery control"
        consumers="every control outside components/ui + components/lang"
      >
        <Lane>
          <Spec cap="neutral · the call site owns its layout">
            <Press className="inline-flex h-6 items-center rounded-md border border-line px-2 t-value font-medium text-ink">
              raw json
            </Press>
          </Spec>
          <Spec cap="icon · the one shape Press draws">
            <Press icon aria-label="refresh" className="size-6 text-ink">
              <RefreshCw className="size-3" />
            </Press>
          </Spec>
          <Spec cap="disabled · no reason, and none is claimed">
            <Press
              disabled
              className="inline-flex h-6 items-center rounded-md border border-line px-2 t-value font-medium text-ink disabled:opacity-50"
            >
              raw json
            </Press>
          </Spec>
        </Lane>
        <Note>
          Press mints no tone and draws no layout — it owns native button semantics, the one hover
          veil, the focus ring and an honest disabled cursor. A control that ACTS on the world is a
          Verb (below), which is where the four tones and the required reason live. Hover and
          :focus-visible cannot be frozen — hover a specimen.
        </Note>
      </Block>

      <Block
        group="ui"
        file="card"
        name="Card · CardHeader · CardTitle · CardDescription · CardAction · CardContent · CardFooter"
        consumers="1 consumer — routes/index"
      >
        <Lane>
          <Spec cap="every slot filled" className="w-72">
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>Overhead Coiling Door 421</CardTitle>
                  <CardDescription>13 params · 3 types</CardDescription>
                </div>
                <CardAction>
                  <Press className={cn(SPEC_PRESS, "h-5 rounded-sm t-caption")}>open</Press>
                </CardAction>
              </CardHeader>
              <CardContent>content</CardContent>
              <CardFooter>footer</CardFooter>
            </Card>
          </Spec>
          <Spec cap="render prop → polymorphic" className="w-52">
            <Card className="p-3 t-label">{"<Card render={<Link/>} />"}</Card>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="combobox"
        name="Combobox · ComboboxTrigger · ComboboxInput · ComboboxContent · ComboboxList · ComboboxItem · ComboboxEmpty · useComboboxAnchor"
        consumers="5 consumers — control-chips, master-table, host/field-options, families, design-system_.popovers"
      >
        <Lane>
          <Spec cap="trigger + searchable popup">
            <ComboboxSpec />
          </Spec>
        </Lane>
        <Note>
          popup position, flip and clamp are the harness at /design-system/popovers — nine instances
          at every viewport corner.
        </Note>
      </Block>

      <Block
        group="ui"
        file="command"
        name="Command · CommandDialog · CommandInput · CommandList · CommandEmpty · CommandGroup · CommandItem · CommandShortcut · CommandSeparator"
        consumers="1 consumer — components/thread-palette"
      >
        <Lane>
          <Spec cap="inline (CommandDialog wraps this in a Dialog)">
            <Bound className="h-44 w-64">
              <Command>
                <CommandInput placeholder="search…" />
                <CommandList>
                  <CommandEmpty>No results.</CommandEmpty>
                  <CommandGroup heading="categories">
                    {CATEGORY_OPTIONS.slice(0, 4).map((o, i) => (
                      <CommandItem key={o.value}>
                        {o.label}
                        <CommandShortcut>⌘{i + 1}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </Bound>
          </Spec>
        </Lane>
        <Note>data-selected drives hover and arrow-key focus alike — arrow through the list.</Note>
      </Block>

      <Block
        group="ui"
        file="dialog"
        name="Dialog · DialogTrigger · DialogContent · DialogHeader · DialogTitle · DialogDescription · DialogFooter · DialogClose · DialogOverlay · DialogPortal"
        consumers="2 consumers — ui/command, routes/takeoffs"
      >
        <Lane>
          <Spec cap="trigger → portalled popup">
            <Dialog>
              <DialogTrigger render={<Press className={SPEC_PRESS} />}>open dialog</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog</DialogTitle>
                  <DialogDescription>
                    Backdrop, portal, close button, escape and click-outside.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </Spec>
        </Lane>
        <Note>open/closed animation and the backdrop cannot be frozen — press the trigger.</Note>
      </Block>

      <Block
        group="ui"
        file="input"
        name="Input"
        consumers="5 consumers — ui/pick-list, grounded-doc, data-tables, ops, schedule-grid"
      >
        <Lane>
          <Spec cap="placeholder">
            <div className="w-40">
              <Input placeholder="search params…" />
            </div>
          </Spec>
          <Spec cap="defaultValue">
            <div className="w-40">
              <Input defaultValue="36 in" />
            </div>
          </Spec>
          <Spec cap="disabled">
            <div className="w-40">
              <Input defaultValue="36 in" disabled />
            </div>
          </Spec>
          <Spec cap="aria-invalid">
            <div className="w-40">
              <Input defaultValue="36 in" aria-invalid />
            </div>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="input-group"
        name="InputGroup · InputGroupAddon · InputGroupButton · InputGroupText · InputGroupInput · InputGroupTextarea"
        consumers="2 consumers — ui/combobox, ui/command (both inside ui/)"
      >
        <Lane>
          <Spec cap="addon align=inline-end + InputGroupButton">
            <div className="w-52">
              <InputGroup>
                <InputGroupInput placeholder="search…" />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="search">
                    <Search />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </Spec>
          <Spec cap="addon align=inline-start">
            <div className="w-52">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Search />
                </InputGroupAddon>
                <InputGroupInput placeholder="search…" />
              </InputGroup>
            </div>
          </Spec>
        </Lane>
      </Block>

      <Block group="ui" file="label" name="Label" consumers="2 consumers — ops, settings">
        <Lane>
          <Spec cap="children">
            <Label>parameter scope</Label>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="pane"
        name="Pane · PaneSplit · PaneWorkspace · PaneKind"
        consumers="2 consumers — family/workspace, takeoff/atlas"
      >
        <Lane>
          {PANE_KINDS.map((k) => (
            <Spec key={k} cap={`kind=${k}`}>
              <Bound className="h-24 w-44">
                <Pane
                  kind={k}
                  title={k}
                  meta="4"
                  actions={
                    <Press
                      icon
                      aria-label="refresh"
                      className="size-5 rounded-sm text-ink hover:veil"
                    >
                      <RefreshCw className="size-2.5" />
                    </Press>
                  }
                >
                  <div className="p-2 t-label text-ink-2">body</div>
                </Pane>
              </Bound>
            </Spec>
          ))}
        </Lane>
        <Note>
          PaneSplit and PaneWorkspace are layout containers with drag/collapse state — mounted for
          real at routes/family and takeoff/atlas.
        </Note>
      </Block>

      <Block
        group="ui"
        file="pick-list"
        name="PickList · PickListItem"
        consumers="2 consumers — data-tables, schedule-grid"
      >
        <Lane>
          <Spec cap="items + groups + meta + activeId">
            <Bound className="h-44 w-56">
              <PickListSpec />
            </Bound>
          </Spec>
          <Spec cap="items=[] → emptyNote">
            <Bound className="h-44 w-56">
              <PickList items={[]} onPick={noop} emptyNote="nothing in scope" />
            </Bound>
          </Spec>
        </Lane>
        <Note>type to narrow · ↑/↓ to move · Enter to pick · Escape to clear.</Note>
      </Block>

      <Block
        group="ui"
        file="select"
        name="Select · SelectTrigger · SelectValue · SelectContent · SelectItem"
        consumers="4 consumers — design-system_.popovers, families, ops, settings"
      >
        <Lane>
          <Spec cap="value set">
            <SelectSpec />
          </Spec>
          <Spec cap="disabled">
            <div className="w-36">
              <Select>
                <SelectTrigger disabled>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="doors">Doors</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="side-pane"
        name="SidePane"
        consumers="5 consumers — chat-shell, data-tables, parameter-links, schedule-grid, workbench/Lens"
      >
        <Lane>
          <Spec cap="side=left · defaultOpen">
            <Bound className="flex h-36 w-64">
              <SidePane
                side="left"
                storageKey="swatch.side-pane.open"
                defaultWidth={150}
                minWidth={110}
                header={<span className="face-mono t-caption">header</span>}
              >
                <div className="p-2 t-label text-ink-2">body</div>
              </SidePane>
              <div className="flex-1" />
            </Bound>
          </Spec>
          <Spec cap="defaultOpen={false} → chevron rail">
            <Bound className="flex h-36 w-64">
              <SidePane
                side="left"
                storageKey="swatch.side-pane.closed"
                defaultOpen={false}
                defaultWidth={150}
                minWidth={110}
                header={<span className="face-mono t-caption">header</span>}
              >
                <div className="p-2 t-label text-ink-2">body</div>
              </SidePane>
              <div className="flex-1" />
            </Bound>
          </Spec>
        </Lane>
        <Note>width drags on the content-facing edge and persists to storageKey.</Note>
      </Block>

      <Block group="ui" file="switch" name="Switch" consumers="1 consumer — routes/ops">
        <Lane>
          <Spec cap="size=default · unchecked">
            <Switch />
          </Spec>
          <Spec cap="size=default · checked">
            <Switch defaultChecked />
          </Spec>
          <Spec cap="size=sm · unchecked">
            <Switch size="sm" />
          </Spec>
          <Spec cap="size=sm · checked">
            <Switch size="sm" defaultChecked />
          </Spec>
          <Spec cap="disabled">
            <Switch disabled />
          </Spec>
          <Spec cap="disabled · checked">
            <Switch disabled defaultChecked />
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="textarea"
        name="Textarea"
        consumers="3 consumers — composer, ui/input-group, ops"
      >
        <Lane>
          <Spec cap="placeholder">
            <div className="w-56">
              <Textarea placeholder="why this write is happening…" />
            </div>
          </Spec>
          <Spec cap="disabled">
            <div className="w-56">
              <Textarea defaultValue="backfill fire ratings" disabled />
            </div>
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="toggle-group"
        name="ToggleGroup · ToggleGroupItem"
        consumers="1 consumer — components/mode-dial"
      >
        <Lane>
          <Spec cap="value + onValueChange">
            <ToggleGroupSpec />
          </Spec>
        </Lane>
      </Block>

      <Block
        group="ui"
        file="value-diff"
        name="ValueDiff"
        consumers="2 consumers — schedule-grid, workbench/plugins/schedule-grid-chat-plugin"
      >
        <Lane>
          <Spec cap="from + to">
            <ValueDiff from="100 VA" to="150 VA" />
          </Spec>
          <Spec cap="from=null → to only">
            <ValueDiff from={null} to="2 hr" />
          </Spec>
          <Spec cap="from === to → to only">
            <ValueDiff from="24 in" to="24 in" />
          </Spec>
          <Spec cap='from="" → em dash'>
            <ValueDiff from="" to="115 V" />
          </Spec>
        </Lane>
      </Block>
    </section>
  );
}

/* ── the specimens that need their own state ─────────────────────────────────────────────── */

type CategoryOption = (typeof CATEGORY_OPTIONS)[number];

function ComboboxSpec() {
  const [picked, setPicked] = useState<CategoryOption | null>(null);
  const anchorRef = useComboboxAnchor();
  return (
    <Combobox
      items={CATEGORY_OPTIONS}
      value={picked}
      onValueChange={(option: CategoryOption | null) => setPicked(option)}
      itemToStringLabel={(option: CategoryOption) => option.label}
    >
      <div ref={anchorRef} className="inline-flex">
        <ComboboxTrigger
          title="Category"
          render={<Press className={cn(SPEC_PRESS, "h-7 w-40 justify-between")} />}
        >
          <span className="truncate">{picked?.label ?? "category"}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef} className="min-w-52">
        <ComboboxInput placeholder="search category…" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: CategoryOption) => (
            <ComboboxItem key={option.value} value={option} className="pr-7">
              <span className="truncate">{option.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function SelectSpec() {
  const [value, setValue] = useState<string>("doors");
  return (
    <div className="w-36">
      <Select value={value} onValueChange={(next: string | null) => setValue(next ?? "")}>
        <SelectTrigger>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PickListSpec() {
  const [active, setActive] = useState<string | null>(PICK_ITEMS[0]?.id ?? null);
  return <PickList items={PICK_ITEMS} activeId={active} onPick={setActive} />;
}

/** The editable cell (R8): commit keeps a number, anything else refuses with a reason. */
function EditableCellSpec() {
  const [value, setValue] = useState("24 in");
  return (
    <StateCell
      scale="row"
      value={value}
      stage="staged"
      onCommit={(text) => {
        if (!/^\d/.test(text.trim())) return "a dimension starts with a number";
        setValue(text);
      }}
    />
  );
}

/** The numeric cell (fit reviews, 2026-08-16): `numeric` parses before `onCommit` — blank or
 *  not-a-number fires the built-in refusal note, so nothing is ever swallowed silently. */
function NumericCellSpec() {
  const [value, setValue] = useState("24");
  return (
    <StateCell
      scale="row"
      value={value}
      numeric={{ min: 0, digits: 1 }}
      onCommit={(text) => setValue(text)}
    />
  );
}

function SwitcherSpec() {
  const [mode, setMode] = useState<"type" | "instance" | "both">("type");
  return (
    <Switcher
      ariaLabel="parameter scope"
      value={mode}
      onChange={setMode}
      options={[
        { value: "type", label: "type", title: "Type-level parameters only" },
        { value: "instance", label: "instance", title: "Instance-level parameters only" },
        { value: "both", label: "both", title: "Needs a document", disabled: true },
      ]}
    />
  );
}

function ToggleGroupSpec() {
  const [value, setValue] = useState("plan");
  return (
    <ToggleGroup value={value} onValueChange={setValue}>
      <ToggleGroupItem value="plan">plan</ToggleGroupItem>
      <ToggleGroupItem value="section">section</ToggleGroupItem>
      <ToggleGroupItem value="3d">3d</ToggleGroupItem>
    </ToggleGroup>
  );
}
