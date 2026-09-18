/**
 * THROWAWAY VARIANTS for the CellSelect question (ruling 5, 2026-09-18). Three editors for one
 * value, each drawn as a real MasterTable cell inside the one cell grammar (StateCell), so the
 * proposal marks and a / d / u are the same in all three and only the editor differs. The loser
 * variants are deleted when Kai picks; the winner moves into `components/master-table/cells.tsx`.
 */
import { useContext, useRef, useState } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { transitionPatches, type TrichotomyCellLike } from "@pe/agent-contracts";

import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { CellHost, cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import { useCellNavigation } from "#/components/master-table/cell-navigation";
import { CellSelect, ReadCell } from "#/components/master-table/cells";
import type { Column } from "#/components/master-table/model";
import { keyMeta } from "#/route/keys";

/** Revit's parameter storage types (host contract `RequestedParameterStorageType`, minus None). */
export const STORAGE = ["String", "Integer", "Double", "ElementId"] as const;
const OPTIONS = STORAGE.map((value) => ({ value, label: value }));

export interface StorageRow {
  key: string;
  baseline: string;
}
/** Parameters of the band's Families matrix and the storage Revit reports for each. */
export const STORAGE_ROWS: StorageRow[] = [
  ["Manufacturer", "String"],
  ["Model", "String"],
  ["Voltage", "String"],
  ["Phase", "Integer"],
  ["MCA", "Double"],
  ["MOCP", "Double"],
  ["Airflow", "Double"],
  ["Weight", "Double"],
].map(([key, baseline]) => ({ key: key!, baseline: baseline! }));

/** Pea proposes three storage changes; you already staged one. */
export const STORAGE_CELLS: Record<string, TrichotomyCellLike> = {
  Voltage: { proposal: { value: "Integer", note: "every voltage in scope is a whole number" } },
  Airflow: { proposal: { value: "Integer" } },
  MCA: { proposal: { value: "String" }, staged: { value: "Integer" } },
};

type Variant = "native" | "popover" | "inline";
export const VARIANTS: { key: Variant; label: string; says: string }[] = [
  { key: "native", label: "A · native select", says: "the browser's own <select> in the cell" },
  { key: "popover", label: "B · popover combobox", says: "today's product CellSelect" },
  {
    key: "inline",
    label: "C · INVENTIVE · inline completion",
    says: "type-to-complete inside the cell; ↑/↓ cycle; no popover",
  },
];

/** Escape from an editor hands focus back to the cell's host (the td), through the registry. */
function useEscapeToHost(editor: HTMLElement | null, restore?: () => void) {
  const host = useContext(CellHost);
  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: () => {
          restore?.();
          host?.current?.focus();
        },
        options: {
          // Never on the document: only once the editor exists.
          enabled: editor !== null,
          ignoreInputs: false,
          meta: keyMeta({
            name: "cancel",
            description: "leave the editor; the cell keeps its value",
            tier: "widget",
            region: "table",
          }),
        },
      },
    ],
    { target: editor },
  );
}

function NativeEditor({ value, commit }: { value: string; commit: (next: string) => void }) {
  const [editor, setEditor] = useState<HTMLSelectElement | null>(null);
  const move = useCellNavigation();
  useEscapeToHost(editor);
  return (
    <select
      ref={setEditor}
      tabIndex={-1}
      value={value}
      className="w-full min-w-0 bg-transparent face-mono"
      onChange={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Tab" && move?.(event.shiftKey ? "left" : "right"))
          event.preventDefault();
      }}
    >
      {STORAGE.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** C: the input completes the first option the typed prefix matches; ↑/↓ cycle all options. */
function InlineEditor({ value, commit }: { value: string; commit: (next: string) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [editor, setEditor] = useState<HTMLInputElement | null>(null);
  const move = useCellNavigation();
  useEscapeToHost(editor, () => {
    if (input.current) input.current.value = value;
  });
  const show = (el: HTMLInputElement, typed: string) => {
    const match = STORAGE.find((option) => option.toLowerCase().startsWith(typed.toLowerCase()));
    el.value = match ?? typed;
    if (match) el.setSelectionRange(typed.length, match.length);
  };
  return (
    <input
      key={value}
      ref={(el) => {
        input.current = el;
        setEditor(el);
      }}
      tabIndex={-1}
      defaultValue={value}
      className="w-full min-w-0 bg-transparent face-mono outline-none"
      onInput={(event) => {
        const el = event.currentTarget;
        show(el, el.value.slice(0, el.selectionStart ?? el.value.length));
      }}
      onKeyDown={(event) => {
        const el = event.currentTarget;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const at = STORAGE.indexOf(el.value as (typeof STORAGE)[number]);
          const next = STORAGE.at((at + (event.key === "ArrowDown" ? 1 : -1)) % STORAGE.length)!;
          el.value = next;
          el.select();
        } else if (event.key === "Enter" || event.key === "Tab") {
          if (STORAGE.includes(el.value as (typeof STORAGE)[number])) commit(el.value);
          else el.value = value;
          if (event.key === "Tab" && move?.(event.shiftKey ? "left" : "right"))
            event.preventDefault();
          else if (event.key === "Enter") move?.("down");
        }
      }}
    />
  );
}

/** One variant column over the shared cells: the same cell grammar, a different editor. */
export const variantColumn = (
  variant: Variant,
  label: string,
  cells: Record<string, TrichotomyCellLike>,
  wire: CellWire,
): Column<StorageRow> => ({
  key: variant,
  label,
  width: "w-44",
  cell: (row) => {
    const cell = cells[row.key] ?? {};
    const rung = (cell.staged ?? cell.proposal)?.value;
    const shown = typeof rung === "string" ? rung : row.baseline;
    const commit = (next: string) =>
      void wire.write(
        transitionPatches(["cells"], row.key, cell, {
          kind: "stage",
          rung: { value: next },
          baseline: { value: row.baseline },
        }),
      );
    const editor =
      variant === "native" ? (
        <NativeEditor value={shown} commit={commit} />
      ) : variant === "popover" ? (
        <CellSelect value={shown} onChange={commit} options={OPTIONS} />
      ) : (
        <InlineEditor value={shown} commit={commit} />
      );
    return (
      <StateCell
        {...cellFromTrichotomy(cell, { value: editor })}
        scale="row"
        transitions={reviewTransitions(wire, row.key, cell)}
      />
    );
  },
});

export const parameterColumn: Column<StorageRow> = {
  key: "parameter",
  label: "parameter",
  width: "w-32",
  lock: true,
  cell: (row) => <ReadCell value={row.key} />,
};
