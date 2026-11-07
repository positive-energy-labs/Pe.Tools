import {
  clearAll,
  summarize,
  cellPatches,
  type CellGroup,
  type RouteStatePatch,
  type CellLike,
} from "@pe/agent-contracts";
import { Undo2 } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import {
  cellFromDraft,
  StateCell,
  type CellTransition,
  type StateCellProps,
} from "@pe/kit/lang/cell";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Verdict } from "@pe/kit/lang/verdict";

interface WorkStandingProps {
  conflict?: boolean;
  unresolved?: readonly string[];
  reload?: () => void;
}

/** The Work in one word for meters and ledgers: "r4 · changed elsewhere"; the sentence owns counts. */
export const workWord = ({
  revision,
  conflict,
  unreadable,
}: {
  revision: number | null;
  conflict?: boolean;
  unreadable?: boolean;
}) =>
  `${unreadable ? "unreadable" : revision === null ? "unwritten" : `r${revision}`}${
    conflict ? " · changed elsewhere" : ""
  }`;

/**
 * A Work's standing lines, none of them cells: what is unresolved (a lost write, a conflicting
 * writer, the last refusal).
 */
export function WorkStanding({
  conflict,
  unresolved = [],
  reload,
}: WorkStandingProps) {
  return (
    <>
      {unresolved.length ? (
        <div
          className="hairline-t flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 t-prose"
          data-tone="caution"
          role="status"
        >
          <span className="w-[9rem] t-small t-upper text-ink-mute">unresolved</span>
          <span>{unresolved.join(" · ")}</span>
          {conflict && reload ? (
            <Button kind="framed" label="reload" onClick={reload}>
              reload
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export const tally = (groups: readonly Pick<CellGroup, "staged" | "byPea">[]) => ({
  staged: groups.reduce((n, group) => n + group.staged, 0),
  byPea: groups.reduce((n, group) => n + group.byPea, 0),
});

/** A Work's cells at head scale: the tally, the contract's groups, and how many at each named depth. */
export interface WorkSummary extends ReturnType<typeof tally> {
  groups: CellGroup[];
  /** Distinct groups at each depth the route names ("3 families"). */
  spans: { noun: string; count: number }[];
}

export function workSummary(
  cells: Record<string, CellLike>,
  ctx: Pick<CellWire, "baselineOf" | "lockOf"> & { groupOf: (key: string) => string[] },
  nouns: readonly string[] = [],
): WorkSummary {
  const { groups } = summarize(cells, {
    groupOf: ctx.groupOf,
    baselineOf: (key) => ctx.baselineOf?.(key),
    lockOf: ctx.lockOf,
  });
  return {
    ...tally(groups),
    groups,
    spans: nouns.map((noun, depth) => ({
      noun,
      count: new Set(groups.map((group) => group.path[depth])).size,
    })),
  };
}

export interface CellWire {
  /** The Work segment holding the cells; null = the cells sit at the Work's root (`launch`). */
  segment: string | null;
  write: (
    patches: RouteStatePatch[],
    expectedRevision?: number,
    context?: { press: string },
  ) => Promise<{ code: string; message: string } | null>;
  pending?: (press: string) => boolean;
  discard?: (press: string) => void;
  revision: number | null;
  lockOf?: (key: string) => string | null;
  baselineOf?: (key: string) => unknown;
}

/** Where a wire's cells sit in its Work: under its segment, or at the root. */
const cellsPath = (wire: CellWire) => (wire.segment === null ? [] : [wire.segment]);

/** Every clear carries the Work revision the person saw. */
const writeKind = (wire: CellWire, patches: RouteStatePatch[]) =>
  wire.revision === null
    ? Promise.resolve({ code: "not-ready", message: "Work has not been read yet" })
    : wire.write(patches, wire.revision);

export function reviewTransitions(wire: CellWire, key: string, cell: CellLike): CellTransition[] {
  return cell.edit == null || wire.lockOf?.(key)
    ? []
    : [
        {
          kind: "clear",
          reason: "Clear the staged value; restore the model value",
          run: () => writeKind(wire, cellPatches(cellsPath(wire), key, cell, { kind: "clear" })),
        },
      ];
}

export interface ClearOutcome {
  kind: "clear";
  covered: string[];
  skipped: { key: string; reason: "locked" | "no-edit" }[];
  refusal: { code: string; message: string } | null;
}

export async function runClear(
  wire: CellWire,
  cells: Record<string, CellLike>,
  keys: readonly string[],
  kind: "clear",
): Promise<ClearOutcome> {
  const { patches, covered, skipped } = clearAll(cells, keys, {
    cellsPath: cellsPath(wire),

    lockOf: wire.lockOf,
  });
  const refusal = covered.length ? await writeKind(wire, patches) : null;
  return { kind, covered, skipped, refusal };
}

export function clearWord({ covered, skipped, refusal }: ClearOutcome): string {
  if (refusal) return refusal.message;
  const by = new Map<"locked" | "no-edit", number>();
  for (const skip of skipped) by.set(skip.reason, (by.get(skip.reason) ?? 0) + 1);
  const reasons = [...by].map(([reason, n]) => `${reason}: ${n}`).join(", ");
  return `cleared ${covered.length}${skipped.length ? ` · skipped ${skipped.length} (${reasons})` : ""}`;
}

export function ReviewRow({
  wire,
  address,
  label,
  cell,
  facts,
  show,
  transitions,
  editor,
  mark = true,
}: {
  wire: CellWire;
  address: string;
  label: ReactNode;
  cell: CellLike;
  facts: StateCellProps;

  show?: (value: unknown) => string;
  /** The consumer's own verbs for this address, when the contract's defaults don't say it. */
  transitions?: readonly CellTransition[];
  /**
   * The table's own cell for this address, editable: drawn in place of the read-only value so a
   * edit value is refined where it is reviewed. Its verbs are its own.
   */
  editor?: ReactNode;

  mark?: boolean;
}) {
  const props = cellFromDraft(cell, {
    ...facts,
    ...(cell.edit && show ? { value: show(cell.edit.delete ? null : cell.edit.value) } : {}),
  });
  const verbs = transitions ?? reviewTransitions(wire, address, cell);
  const by = props.author;
  return (
    <div
      className={`dl-review my-px grid h-(--item-h) items-center gap-2 ${
        mark
          ? "grid-cols-[minmax(6rem,14rem)_minmax(0,22rem)_7rem]"
          : "grid-cols-[minmax(6rem,14rem)_minmax(0,22rem)]"
      }`}
      style={{ "--acts": verbs.length } as CSSProperties}
    >
      <span className="min-w-0 truncate">{label}</span>
      {editor ?? <StateCell {...props} scale="row" transitions={verbs} />}
      {mark ? (
        <span
          className="truncate t-small face-mono text-ink-2"
          data-tone={by === "pea" ? "pea" : undefined}
        >
          {props.stage} · {by === "pea" ? "pea" : "you"}
        </span>
      ) : null}
    </div>
  );
}

export const reviewAddresses = <C extends CellLike>(cells: Record<string, C>) =>
  Object.entries(cells).filter(([, cell]) => cell.edit != null);

export function UnstageAll({
  wire,
  cells,
  keys,
  done,
  compact,
}: {
  wire: CellWire;
  cells: Record<string, CellLike>;
  keys: readonly string[];
  done: (outcome: ClearOutcome) => void;
  /** A framed revert button with its count, for a one-line row; the words move to the title. */
  compact?: boolean;
}) {
  const covered = useMemo(
    () => clearAll(cells, keys, { cellsPath: cellsPath(wire), lockOf: wire.lockOf }),
    [cells, keys, wire],
  );
  const [failure, setFailure] = useState<string | null>(null);
  const sending = useRef(false);
  const count = covered.covered.length;
  if (!count) return null;
  const edits = plural(count, "edit");
  const title = `Clear ${edits} in one write; undo restores them.`;
  const press = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      const outcome = await runClear(wire, cells, keys, "clear");
      setFailure(outcome.refusal?.message ?? null);
      if (!outcome.refusal) done(outcome);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      sending.current = false;
    }
  };
  return (
    <>
      {compact ? (
        <Button
          kind="framed"
          icon={Undo2}
          label={`Revert ${edits}`}
          reason={title}
          onClick={() => void press()}
        >
          <span className="face-mono">{count}</span>
        </Button>
      ) : (
        <TooltipHint content={title}>
          <Verdict kind="clear" onClick={() => void press()}>
            revert all ({count})
          </Verdict>
        </TooltipHint>
      )}
      {failure && (
        <span role="alert" data-tone="caution">
          Revert was not saved: {failure}. Press again to retry.
        </span>
      )}
    </>
  );
}

/** `3 families`: a count and its English plural. */
export const plural = (n: number, noun: string) =>
  `${n} ${n === 1 ? noun : noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;

export function WorkSentence({
  summary,
  cells,
  wire,
  commit,
}: {
  summary: WorkSummary;
  cells: Record<string, CellLike>;
  wire: CellWire;
  /** The consumer's commit verb, drawn while something is edit. */
  commit?: ReactNode;
}) {
  const [outcome, setOutcome] = useState<ClearOutcome | null>(null);
  const { staged, byPea, spans } = summary;
  if (!staged) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2 t-prose">
      <span>
        {plural(staged, "staged cell")} · {byPea} by Pea
        {spans.map((span) => ` · ${plural(span.count, span.noun)}`)}
      </span>
      {outcome ? <span role="status">{clearWord(outcome)}</span> : null}
      <UnstageAll wire={wire} cells={cells} keys={Object.keys(cells)} done={setOutcome} />
      {commit}
    </div>
  );
}
