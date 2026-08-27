/**
 * /design-system/popovers — SATELLITE. What it stress-tests: **popover POSITION, per component,
 * at every corner of a real viewport.**
 *
 * Standing directive (CLEANROOM, ruled 2026-08-16): every popover-bearing component is tested
 * across viewport positions, because combobox, targeting dropdown and search boxes have multiple
 * composition paths in the app. A harness that puts nine instances of the same specimen at the
 * corners, edges and centre of the viewport asks the browser the same placement questions at each
 * position.
 *
 * THIS PAGE DOES NOT CLAIM BROWSER PROOF. Each specimen is mounted EXACTLY as its real consumer
 * mounts it — the same composition and the same meaningful alignment/anchor props. The shared
 * popup surface and width law are now fixed in `components/ui/`; the remaining positioning and
 * composition observations stay visible here for the browser gate.
 *
 * WHY TWO SPECIMENS ARE COMPOSED HERE RATHER THAN IMPORTED: the facet filter (`master-table`) and
 * the picker chip (`control-chips`) are PRIVATE functions inside their consumers. There is no
 * component to import — the composition is duplicated per consumer, which is itself the finding.
 * `FieldOptionSelect` and `FieldOptionMultiSelect` are real exported components and are mounted
 * directly.
 *
 * FIXTURE, ANNOUNCED: the option lists are `design-system/fixtures.ts`. No host, no document, no
 * live catalogue call (SHIMS entry 4).
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/ThemeToggle";
import { FactChip } from "#/components/lang/chip";
import { Button } from "#/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { FieldOptionMultiSelect, FieldOptionSelect, type FieldOption } from "#/host/field-options";
import { CATEGORY_OPTIONS } from "#/design-system/fixtures";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/design-system_/popovers")({ component: PopoverHarness });

const FIELD_OPTIONS: FieldOption[] = CATEGORY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  description: o.description ?? null,
}));

/* ── the specimens ───────────────────────────────────────────────────────────────────────── */

interface Specimen {
  id: string;
  name: string;
  /** Named inline — the index law applies to satellites too. */
  consumers: string;
  /** What this composition does that the others do not. */
  shape: string;
  /** Source facts and browser questions. */
  defects: readonly string[];
  render: () => React.ReactNode;
}

/** As `master-table.tsx`'s private `ColFilter` composes it: explicit anchor on the trigger, an
 *  in-popup search input once the option list is long, `side`/`align` left at the wrapper default. */
function FacetFilterSpecimen() {
  const [value, setValue] = useState<{ value: string | null; label: string } | null>(null);
  const choices = useMemo(
    () => [
      { value: null as string | null, label: "any" },
      ...CATEGORY_OPTIONS.map((o) => ({ value: o.value as string | null, label: o.label })),
    ],
    [],
  );
  const anchorRef = useComboboxAnchor();
  const selected = value ?? choices[0]!;
  return (
    <Combobox
      items={choices}
      value={selected}
      onValueChange={(choice: { value: string | null; label: string } | null) =>
        setValue(choice ?? null)
      }
      itemToStringLabel={(choice: { value: string | null; label: string }) => choice.label}
    >
      <div ref={anchorRef} className="flex">
        <ComboboxTrigger
          aria-label="category filter"
          className={cn(
            "face-mono t-value flex h-5 w-32 items-center justify-between gap-0.5 rounded-md border bg-transparent px-1 font-normal outline-none",
            selected.value
              ? "border-primary/40 bg-primary/[0.06] text-foreground"
              : "border-line text-muted-foreground",
          )}
        >
          <span className="truncate normal-case">{selected.label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef} className="[--popup-min-width:11rem] rounded-md">
        <ComboboxInput placeholder="filter values…" />
        <ComboboxEmpty>No matching values</ComboboxEmpty>
        <ComboboxList>
          {(choice: { value: string | null; label: string }) => (
            <ComboboxItem key={choice.value ?? "\u0000all"} value={choice} className="pr-7">
              <span className="truncate">{choice.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** As `control-chips.tsx`'s private `Picker` composes it: a ghost Button as the trigger,
 *  `align="end"`, an explicit anchor, and a searchable popup. */
function PickerChipSpecimen() {
  const [picked, setPicked] = useState<(typeof CATEGORY_OPTIONS)[number] | null>(null);
  const anchorRef = useComboboxAnchor();
  return (
    <Combobox
      items={CATEGORY_OPTIONS}
      value={picked}
      onValueChange={(option: (typeof CATEGORY_OPTIONS)[number] | null) => setPicked(option)}
      itemToStringLabel={(option: (typeof CATEGORY_OPTIONS)[number]) => option.label}
    >
      <div ref={anchorRef} className="inline-flex">
        <ComboboxTrigger
          title="Category"
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-40 justify-between gap-1 px-2 text-muted-foreground"
            />
          }
        >
          <span className="face-mono t-value truncate">{picked?.label ?? "category"}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent align="end" anchor={anchorRef} className="[--popup-min-width:14rem]">
        <ComboboxInput placeholder="Search category…" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: (typeof CATEGORY_OPTIONS)[number]) => (
            <ComboboxItem key={option.value} value={option} className="flex-col items-start pr-7">
              <span className="text-foreground">{option.label}</span>
              {option.description ? (
                <span className="text-xs text-muted-foreground">{option.description}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function SelectSpecimen() {
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
      <FieldOptionMultiSelect items={FIELD_OPTIONS} values={values} onChange={setValues} />
    </div>
  );
}

const SPECIMENS: readonly Specimen[] = [
  {
    id: "facet",
    name: "combobox · facet filter",
    consumers:
      "components/master-table/master-table.tsx → every MasterTable column header (atlas/takeoffs, families, data-tables)",
    shape: "explicit anchor on the trigger · in-popup search · wrapper default side/align",
    defects: [
      "FIXED IN SOURCE — caller intent is now `[--popup-min-width:11rem]`; shared CSS computes `min(available, max(anchor, caller))`, grows to content, and clamps to the available viewport. Browser sizing remains pending.",
      "BROWSER CHECK — at the bottom edge, does Base UI flip the popup upward, and does the in-popup search stay at the popup top or move with the trigger? Compare its distance from the clicked trigger.",
      "no component to import: `ColFilter` is a private function inside master-table.tsx, so this composition is duplicated wherever a facet filter is wanted.",
      "the anchor is an extra `div` that keeps the in-popup search input out of the positioner anchor. BROWSER CHECK — does this composition keep popup positioning stable while the search input changes?",
    ],
    render: () => <FacetFilterSpecimen />,
  },
  {
    id: "picker",
    name: "combobox · picker chip",
    consumers: "components/control-chips.tsx → the chat composer, families",
    shape: "ghost Button trigger · align=end · explicit anchor · searchable",
    defects: [
      "FIXED IN SOURCE — caller intent is now `[--popup-min-width:14rem]`; shared CSS composes it with the anchor floor and viewport ceiling while permitting content growth. Browser readability remains pending.",
      'BROWSER CHECK — with `align="end"`, does the popup remain right-aligned for this chip at each viewport position? Keep this caller alignment rather than forcing a global alignment.',
      "same private-function problem: `Picker` is internal to control-chips.tsx.",
      "the trigger is a shadcn ghost Button on `--muted-foreground` while the facet filter is a bare `ComboboxTrigger` on `--r-line` — the same control, two visual identities. (The `--line-soft` shim this note used to cite is deleted.)",
    ],
    render: () => <PickerChipSpecimen />,
  },
  {
    id: "select",
    name: "ui/select",
    consumers:
      "routes/settings.tsx, routes/ops.tsx (bridge session + scalar fields), routes/families.tsx",
    shape: "Base UI Select — positions against the SELECTED ITEM, not the trigger",
    defects: [
      "FIXED IN SOURCE — Select and Combobox now share the same artifact ground, radius, ring, ink, and `--r-on` contract; both retain their Base UI width behavior and caller alignment/overflow choices.",
      "BROWSER CHECK — at the bottom-left corner, where does the selected-item positioner place the popup, and does it remain within the available viewport without unintended overlap? This wave preserves the Base UI positioning contract.",
      "FIXED IN SOURCE — Select no longer uses the old `--popover`/`--border` vocabulary; visual retint and contrast still require the browser gate.",
    ],
    render: () => <SelectSpecimen />,
  },
  {
    id: "field",
    name: "FieldOptionSelect",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "the INPUT is the trigger · NO explicit anchor · defaults everywhere",
    defects: [
      "FIXED IN SOURCE — the shared `w-max` plus anchor-floor law lets this option list grow past the input to readable content width, bounded by available viewport width. Browser sizing remains pending.",
      "no explicit anchor is passed, unlike BOTH other combobox consumers, which each wrote an anchor `div` with a comment explaining that the in-popup input must not be the positioner anchor. Nothing in the API says which shape needs it — the knowledge lives in two ponytail comments.",
      "BROWSER CHECK — at the bottom edge, does the popup flip as intended? Separately compare the description styles: this consumer uses `text-[10px] text-muted-foreground` while the picker chip uses `text-xs text-muted-foreground`.",
    ],
    render: () => <FieldSelectSpecimen />,
  },
  {
    id: "multi",
    name: "FieldOptionMultiSelect",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "chips container is the anchor · the anchor GROWS as chips are added",
    defects: [
      "BROWSER CHECK — while the popup is open, what happens to its position when adding chips changes the anchor width, especially at the bottom edge?",
      "FIXED IN SOURCE — chips and unanchored inputs now use the same width law. BROWSER CHECK — does the chip anchor reposition the open popup as chip count changes?",
      "FIXED — the trailing count line spent `--lichen`, a raw palette hue from the old vocabulary; it now sits on `--r-ink-2` (and the old cat-lichen identity lives on only as `--viz-4`).",
    ],
    render: () => <FieldMultiSpecimen />,
  },
];

/* ── the harness ─────────────────────────────────────────────────────────────────────────── */

const POSITIONS: readonly { id: string; cls: string }[] = [
  { id: "top-left", cls: "items-start justify-start" },
  { id: "top-centre", cls: "items-start justify-center" },
  { id: "top-right", cls: "items-start justify-end" },
  { id: "mid-left", cls: "items-center justify-start" },
  { id: "centre", cls: "items-center justify-center" },
  { id: "mid-right", cls: "items-center justify-end" },
  { id: "bottom-left", cls: "items-end justify-start" },
  { id: "bottom-centre", cls: "items-end justify-center" },
  { id: "bottom-right", cls: "items-end justify-end" },
];

function PopoverHarness() {
  const [id, setId] = useState<string>(SPECIMENS[0]!.id);
  const specimen = SPECIMENS.find((s) => s.id === id) ?? SPECIMENS[0]!;

  return (
    /* The grid represents the viewport positions. The control panel lives in the centre cell so
       the browser can compare it with the edge positions. */
    <div className="fixed inset-0 grid grid-cols-3 grid-rows-3 gap-2 bg-page p-2 text-[13px] text-ink">
      {POSITIONS.map((p) => (
        <div key={p.id} className={cn("relative flex min-h-0 min-w-0", p.cls)}>
          <span className="face-mono t-caption pointer-events-none absolute top-0 left-0 tracking-[0.09em] text-ink-mute uppercase">
            {p.id}
          </span>
          {p.id === "centre" ? (
            <div className="flex max-h-full min-h-0 flex-col items-center gap-3 overflow-auto">
              <Panel specimen={specimen} onPick={setId} />
              <div key={`${specimen.id}-${p.id}`}>{specimen.render()}</div>
            </div>
          ) : (
            <div key={`${specimen.id}-${p.id}`}>{specimen.render()}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function Panel({ specimen, onPick }: { specimen: Specimen; onPick: (id: string) => void }) {
  return (
    <div className="max-w-[34rem] min-w-0 border border-line bg-artifact p-3 [--r-on:var(--r-artifact)]">
      <div className="flex flex-wrap items-baseline gap-2 pb-2">
        <Link to="/design-system" className="text-[11px] text-nav hover:underline">
          ← design system
        </Link>
        <span className="font-pe-display text-[13px] font-semibold">popover position harness</span>
        <FactChip dashed title="Fixture option lists — no host, no live catalogue call.">
          fixture
        </FactChip>
        <ThemeToggle />
      </div>

      <div className="flex flex-wrap gap-1 border-t border-line pt-2">
        {SPECIMENS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            title={`Mount ${s.name} at all nine positions`}
            className={cn(
              "border px-1.5 py-0.5 font-pe-mono text-[10px]",
              s.id === specimen.id ? "border-line-2 bg-select text-ink" : "border-line text-ink-2",
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 pt-2.5">
        <span className="text-[10px] text-ink-mute">consumers: {specimen.consumers}</span>
        <span className="font-pe-mono text-[10px] text-ink-2">shape: {specimen.shape}</span>
        {specimen.defects.map((d) => (
          <p
            key={d}
            className="border-l border-dashed border-line-2 pl-2 font-pe-mono text-[10px] leading-relaxed text-ink-2"
          >
            <span className="text-caution">testimony · </span>
            {d}
          </p>
        ))}
        <p className="border-l border-line-2 pl-2 font-pe-mono text-[10px] leading-relaxed text-ink-2">
          <span className="text-alarm">the source headline · </span>
          Combobox now composes <code>min(available, max(anchor, caller))</code> from its shared CSS
          class; callers encode wider requests as <code>--popup-min-width</code>, so
          <code>11rem</code>, <code>14rem</code>, and <code>13rem</code> do not collide with the
          anchor term. <code>w-max</code> permits content growth and the available-width term is the
          ceiling. Select and Combobox also consume the same canonical popup surface; Base UI
          positioning and browser sizing remain pending observation.
        </p>
        <p className="pt-1 text-[10px] leading-relaxed text-ink-mute">
          Open the same specimen at all nine positions and compare. The harness does not claim
          browser correction; each specimen is mounted exactly as its consumer mounts it. Fixed
          source laws are labeled above; the remaining flip, clamp, alignment, and content
          observation obligations are still pending.
        </p>
      </div>
    </div>
  );
}
