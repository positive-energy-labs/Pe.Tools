/**
 * /design-system/popovers — SATELLITE. What it stress-tests: **popover POSITION, per component,
 * at every corner of a real viewport.**
 *
 * Standing directive (CLEANROOM, ruled 2026-08-16): every popover-bearing component is tested
 * across viewport positions, because combobox, targeting dropdown and search boxes are
 * inconsistent in both style and popover behaviour everywhere in the app, and nobody has ever
 * seen that inconsistency as ONE fact. A harness that puts nine instances of the same specimen at
 * the corners, edges and centre of the viewport turns "it sometimes opens wrong" into a picture.
 *
 * THIS PAGE FIXES NOTHING. It does not pass better `side`/`align` props, does not add collision
 * padding, does not restyle a popup. Each specimen is mounted EXACTLY as its real consumer mounts
 * it — the same composition, the same props, the same omissions — so what you see here is what
 * that consumer ships. Every observed defect is written down beside the picker. Discharging them
 * is SHIMS entry 7: one popover foundation in `components/lang/` that every popover-bearing
 * component sits on, adopted during the crusade.
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

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/lang/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/lang/select";
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
  /** Observed vs expected. Written down, not fixed. */
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
        <ComboboxTrigger aria-label="category filter">
          <span>{selected.label}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef}>
        <ComboboxInput placeholder="filter values…" />
        <ComboboxEmpty>No matching values</ComboboxEmpty>
        <ComboboxList>
          {(choice: { value: string | null; label: string }) => (
            <ComboboxItem key={choice.value ?? "all"} value={choice}>
              <span>{choice.label}</span>
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
      <div
        ref={anchorRef}
        className="inline-flex max-w-40 [&>button]:max-w-full [&>button]:justify-between [&>button]:gap-1"
      >
        <ComboboxTrigger
          title="Category"
          render={<Press tone="quiet" size="value" state="selected" />}
        >
          <span>{picked?.label ?? "category"}</span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent align="end" anchor={anchorRef}>
        <ComboboxInput placeholder="Search category…" />
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(option: (typeof CATEGORY_OPTIONS)[number]) => (
            <ComboboxItem key={option.value} value={option}>
              <span>{option.label}</span>
              {option.description ? <span>{option.description}</span> : null}
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
      "OBSERVED — the consumer asks for `min-w-44` and gets the anchor's width instead: `ComboboxContent`'s base `w-(--anchor-width)` wins the merge, so every option longer than the trigger truncates (`Curtain Pa…`, `Mechanic…`). The filter is the one place you cannot read the values you are filtering by.",
      "OBSERVED — flip works (bottom edge opens upward) but the in-popup search input stays at the popup's top, so after a flip the search box is the FURTHEST thing from the trigger you just clicked.",
      "no component to import: `ColFilter` is a private function inside master-table.tsx, so this composition is duplicated wherever a facet filter is wanted.",
      "the anchor is an extra `div` that exists only to stop the in-popup search input from becoming the positioner anchor (a jitter loop). Every consumer has to know that.",
    ],
    render: () => <FacetFilterSpecimen />,
  },
  {
    id: "picker",
    name: "combobox · picker chip",
    consumers: "components/control-chips.tsx → the chat composer, families",
    shape: "ghost Button trigger · align=end · explicit anchor · searchable",
    defects: [
      "OBSERVED, and it is the worst of the set — `min-w-56` is likewise beaten by `w-(--anchor-width)`, and this trigger's anchor is a ~6rem ghost Button, so the two-line items wrap character-by-character: `Windo / ws`, `OST_D / oors`. Unreadable at every one of the nine positions.",
      'OBSERVED — `align="end"` is hard-coded, so the popup is right-aligned to the anchor everywhere, including at the left edge where there is nothing to avoid.',
      "same private-function problem: `Picker` is internal to control-chips.tsx.",
      "the trigger is a shadcn ghost Button on `--muted-foreground` while the facet filter is a bare `ComboboxTrigger` on `--pe-line` — the same control, two visual identities. (The `--line-soft` shim this note used to cite is deleted.)",
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
      "OBSERVED — Select's popup GROWS to fit its content (350px from a 9rem trigger) while Combobox's SHRINKS to its anchor. The two dropdown families in this app have opposite width laws, which is the single loudest inconsistency the harness exposes.",
      "OBSERVED — the popup aligns the SELECTED item over the trigger, so at the bottom-left corner it lands up and to the right, on top of whatever it overlaps. Correct Base UI behaviour; wrong next to four neighbours that anchor below.",
      "styled on `--popover`/`--border`, the old vocabulary, so it cannot be retinted by the `--pe-*` layer at all — and in dark the popup ground is visibly lighter than every other popup on this page.",
    ],
    render: () => <SelectSpecimen />,
  },
  {
    id: "field",
    name: "FieldOptionSelect",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "the INPUT is the trigger · NO explicit anchor · defaults everywhere",
    defects: [
      "OBSERVED — anchor-width again: `Mechanical Equipment` wraps onto two lines here while `ui/select` renders the same option on one. Same data, same page, two answers.",
      "no explicit anchor is passed, unlike BOTH other combobox consumers, which each wrote an anchor `div` with a comment explaining that the in-popup input must not be the positioner anchor. Nothing in the API says which shape needs it — the knowledge lives in two ponytail comments.",
      "OBSERVED — flips at the bottom edge (correct), but the description sub-line is `t-caption text-ink-2` here and `t-value text-ink-2` in the picker chip: the same option list, rendered at two sizes by two consumers.",
    ],
    render: () => <FieldSelectSpecimen />,
  },
  {
    id: "multi",
    name: "FieldOptionMultiSelect",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "chips container is the anchor · the anchor GROWS as chips are added",
    defects: [
      "the anchor is the chips container, which GROWS every time a chip is added, so an open popup re-positions mid-selection — worst at the bottom edge, where each new chip can force a flip.",
      "`data-chips` switches the popup to `min-w-(--anchor-width)` — the ONLY consumer that escapes the anchor-width clamp, and it escapes it by accident of which sub-component was anchored.",
      "FIXED — the trailing count line spent `--lichen`, a raw palette hue from the old vocabulary; it now sits on `--pe-ink-2` (and the old cat-lichen identity lives on only as `--viz-4`).",
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
    /* The grid IS the viewport — no page header, because a header would push the top row down and
       the top row is the whole point. The control panel lives in the centre cell, which is the one
       position with nothing to clamp against. */
    <div className="grid grid-cols-3 grid-rows-3 gap-2 p-2">
      {POSITIONS.map((p) => (
        <div key={p.id} className={cn("flex min-h-0 min-w-0", p.cls)}>
          <span>{p.id}</span>
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
    <div className="max-w-[34rem] min-w-0 p-3">
      <div className="flex flex-wrap items-baseline gap-2 pb-2">
        <Link to="/design-system">← design system</Link>
        <span>popover position harness</span>
        <FactChip dashed title="Fixture option lists — no host, no live catalogue call.">
          fixture
        </FactChip>
        <ThemeToggle />
      </div>

      <div className="flex flex-wrap gap-1 pt-2">
        {SPECIMENS.map((s) => (
          <Press
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            title={`Mount ${s.name} at all nine positions`}
            size="caption"
            tone={s.id === specimen.id ? "neutral" : "quiet"}
            state={s.id === specimen.id ? "selected" : "rest"}
          >
            {s.name}
          </Press>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 pt-2.5">
        <span>consumers: {specimen.consumers}</span>
        <span>shape: {specimen.shape}</span>
        {specimen.defects.map((d) => (
          <p key={d} className="pl-2">
            <span>observed · </span>
            {d}
          </p>
        ))}
        <p className="pl-2">
          <span>the headline · </span>
          three of the four combobox consumers ask for a wider popup than their anchor (
          <code>min-w-44</code>, <code>min-w-56</code>) and every one of them is overruled by{" "}
          <code>ComboboxContent</code>&apos;s own <code>w-(--anchor-width)</code>. Meanwhile{" "}
          <code>ui/select</code> grows to fit its content. Two dropdown families, opposite width
          laws, and the request the consumer wrote down is silently ignored.
        </p>
        <p className="pt-1">
          Open the same specimen at all nine positions and compare. Nothing here is corrected — each
          is mounted exactly as its consumer mounts it, so the inconsistency you see is the
          inconsistency that ships. One popover foundation in <code>components/lang/</code>{" "}
          discharges it (SHIMS entry 7).
        </p>
      </div>
    </div>
  );
}
