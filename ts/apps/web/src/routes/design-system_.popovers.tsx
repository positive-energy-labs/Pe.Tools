/**
 * /design-system/popovers — SATELLITE. What it stress-tests: **popover POSITION, per component,
 * at every corner of a real viewport.**
 *
 * Standing directive (CLEANROOM, ruled 2026-08-16): every popover-bearing component is tested
 * across viewport positions. A harness that puts nine instances of the same specimen at the
 * corners, edges and centre of the viewport turns "it sometimes opens wrong" into a picture.
 *
 * THIS PAGE OWNS NO POPUP FIXES. Each specimen is mounted EXACTLY as its real consumer mounts it,
 * so what you see here is what that consumer ships. The notes distinguish current defects from
 * repairs now owned by the shared language primitives.
 *
 * The facet filter and the picker chip are compositions of the one `ListPopup` (the list grammar),
 * repeated here as their consumers write them. `FieldOptionSelect` and `FieldOptionPicker` are
 * real exported components and are mounted directly.
 *
 * SPECIMEN DATA, ANNOUNCED: the option lists are `design-system/specimens-data.ts`. No host, no document, no
 * live catalogue call (SHIMS entry 4).
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { FactChip } from "#/components/lang/chip";
import { ListPopup } from "#/components/lang/list-popup";
import { Switcher } from "#/components/lang/switcher";
import { FieldOptionPicker, FieldOptionSelect, type FieldOption } from "#/host/field-options";
import { CATEGORY_OPTIONS } from "#/design-system/specimens-data";
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
  /** Current observation or a defect discharged by the shared primitive. */
  defects: readonly string[];
  render: () => React.ReactNode;
}

type Choice = { value: string; label: string; description?: string };
const CHOICES: Choice[] = CATEGORY_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  description: o.description ?? undefined,
}));

/** As `master-table-header.tsx`'s `ColFilter` composes it: a filling trigger, search above 8. */
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

const SPECIMENS: readonly Specimen[] = [
  {
    id: "facet",
    name: "ListPopup · facet filter",
    consumers:
      "components/master-table/master-table-header.tsx → every Table column header (atlas/takeoffs, families, data-tables)",
    shape: "ListPopup face=fill · search above 8 · the trigger is the anchor",
    defects: [
      "FIXED — the list grammar cutover: the trigger is always the anchor, so no consumer writes an anchor `div`.",
      "OBSERVED — flip works (bottom edge opens upward) but the in-popup search input stays at the popup's top, so after a flip the search box is the FURTHEST thing from the trigger you just clicked.",
    ],
    render: () => <FacetFilterSpecimen />,
  },
  {
    id: "picker",
    name: "ListPopup · picker chip",
    consumers: "chat/head-chips.tsx (Ladder face=inline) → the chat composer, families",
    shape: "ListPopup face=inline · searchable · two-line rows · collision fit",
    defects: [
      "FIXED — the list grammar cutover: one trigger recipe with three faces (inline, fill, field); the chip and the facet differ only by face.",
    ],
    render: () => <PickerChipSpecimen />,
  },
  {
    id: "field",
    name: "FieldOptionSelect",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "ListPopup face=field · async status · a stale value stays, refused",
    defects: [
      "FIXED — the list grammar cutover: the description is the Row's `sub` slot, one size in every consumer.",
    ],
    render: () => <FieldSelectSpecimen />,
  },
  {
    id: "multi",
    name: "FieldOptionPicker",
    consumers: "routes/ops.tsx, ops/views-catalog.tsx, parameter-links/ProfileEditor.tsx",
    shape: "ListPopup face=field, select=multi · chips are the trigger's face",
    defects: [
      "OBSERVED — the trigger is the chips row, which grows as chips are added, so an open popup can re-position mid-selection at the bottom edge.",
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
    <div className="grid h-dvh min-h-0 grid-cols-3 grid-rows-3 gap-2 overflow-hidden p-2">
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

      <div className="pt-2">
        <Switcher
          ariaLabel="specimen"
          value={specimen.id}
          onChange={onPick}
          options={SPECIMENS.map((s) => ({
            value: s.id,
            label: s.name,
            title: `Mount ${s.name} at all nine positions`,
          }))}
        />
      </div>

      <div className="flex flex-col gap-1.5 pt-2.5">
        <span>consumers: {specimen.consumers}</span>
        <span>shape: {specimen.shape}</span>
        {specimen.defects.map((d) => (
          <p key={d} className="pl-2">
            <span>finding · </span>
            {d}
          </p>
        ))}
        <p className="pl-2">
          <span>the headline · </span>
          Select matches its trigger. A single-value Combobox uses the greater of its anchor and a
          10rem reading floor. A multiple Combobox matches its chips anchor. Both families open
          bottom/start with Base UI collision handling unless a consumer explicitly changes align.
        </p>
        <p className="pt-1">
          Open the same specimen at all nine positions and compare. Each instance is mounted exactly
          as its consumer mounts it, so the remaining defects here are the defects that ship.
        </p>
      </div>
    </div>
  );
}
