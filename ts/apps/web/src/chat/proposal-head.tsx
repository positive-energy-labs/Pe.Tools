/** The composer's Work rows: one line per Work the thread's document holds, counts only; `review ▾`
 *  expands it into at most five groups whose accept and deny are `fanOut`s of the route's own cell
 *  transitions. Every exit opens the route in Chat's plugin pane; it never lists cells. */
import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { fanOut, type CellGroup, type CellLike } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import {
  fanOutWord,
  runFanOut,
  tally,
  UnstageAll,
  workSummary,
  type CellWire,
  type FanOutOutcome,
} from "#/components/work/band";
import { Verdict } from "@pe/kit/lang/verdict";
import { TooltipHint } from "@pe/kit/lang/tooltip";
export interface HeadWork {
  id: string;
  /** The route title, e.g. "Families". */
  route: string;
  /** The Work's entity, or the document name for a document-wide route. */
  subject: string;
  cells: Record<string, CellLike>;
  /** How the cells are written; bound kinds carry `wire.revision`, the rendered revision. */
  wire: CellWire;
  /** The route's full group path for a key. */
  groupOf: (key: string) => string[];
  /** The route's own value formatter. */
  show?: (value: unknown) => string;
  stale?: boolean;
  /** A foreign write refused this Work's last bound write. */
  conflict?: boolean;
  reload?: () => void;
  pending?: readonly {
    press: string;
    retry(): Promise<unknown>;
    discard(this: void): void;
  }[];
  /** The route's commit word ("apply"); pressing it opens the pane unscoped and runs it there. */
  commit: { word: string; run: () => void };
  /** A group's words when its path key is a machine key (a loss rule's key). */
  label?: (group: string) => string;
  /** Open the route in the plugin pane, landing on a cell's own place (its key), else unscoped. */
  open: (cell?: string) => void;
  /** Works sharing a line are one Work in two segments: one head line, one commit (F-B-4). */
  line?: string;
  /** The head's plan, refused where it ran; said here, where it was pressed (F-B-5). */
  refusal?: string;
}
const REST_WORKS = 3;
const GROUP_ROWS = 5;
const EXAMPLES = 2;
const COMMIT_REASON =
  "Open the plan in the pane — staging is not applying; the confirmation lists every change before Revit changes";
const pending = (cell: CellLike) => cell.suggestion != null || cell.edit != null;
const showDefault = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
/** Full group paths, contested first, then by pending size, then label. */
function headGroups(work: Pick<HeadWork, "cells" | "groupOf" | "wire">): CellGroup[] {
  const { groups } = workSummary(work.cells, {
    ...work.wire,
    groupOf: work.groupOf,
  });
  return groups.sort(
    (a, b) =>
      Number(b.contested > 0) - Number(a.contested > 0) ||
      b.proposed + b.staged - (a.proposed + a.staged) ||
      JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)),
  );
}
/** `{P} proposed · {S} edit · {C} contested`, zeros omitted. */
function Counts({ proposed, edit, contested }: ReturnType<typeof tally>) {
  const parts: ReactNode[] = [];
  if (proposed)
    parts.push(
      <span key="p" data-tone="pea">
        {proposed} proposed
      </span>,
    );
  if (edit) parts.push(<span key="s">{edit} edit</span>);
  if (contested)
    parts.push(
      <span key="c" data-tone="caution">
        {contested} contested
      </span>,
    );
  return (
    <span>
      {parts.map((part, i) => (
        <span key={i}>
          {i ? " · " : null}
          {part}
        </span>
      ))}
    </span>
  );
}
export function ProposalHead({ asks, works }: { asks: readonly ReactNode[]; works: HeadWork[] }) {
  const [all, setAll] = useState(false);
  const lines = new Map<string, HeadWork[]>();
  for (const work of works.filter(
    (one) => Object.values(one.cells).some(pending) || one.pending?.length,
  ))
    lines.set(work.line ?? work.id, [...(lines.get(work.line ?? work.id) ?? []), work]);
  const live = [...lines.values()];
  if (!asks.length && !live.length) return null;
  const shown = all || live.length <= REST_WORKS ? live : live.slice(0, REST_WORKS);
  const rest = live.slice(shown.length).map((parts) => tally(parts.flatMap(headGroups)));
  // A refusal belongs to the route, not the line: three Ducts lines refused for one reason say it once.
  const refusals = new Map<string, string>();
  for (const parts of shown)
    if (parts[0]!.refusal) refusals.set(parts[0]!.route, parts[0]!.refusal);
  return (
    <div
      aria-label="Pea proposals"
      className="hairline-b-faint flex flex-col gap-1 px-(--gutter) py-1.5"
    >
      {asks.length > 0 && <div className="hairline-b-faint mb-1 pb-1">{asks}</div>}
      {shown.map((parts) => (
        <WorkLine key={parts[0]!.id} parts={parts} />
      ))}
      {[...refusals].map(([route, refusal]) => (
        <p key={route} className="t-small" data-tone="caution">
          {route}: {refusal}
        </p>
      ))}
      {rest.length ? (
        <Button kind="framed" label="Show the remaining routes" onClick={() => setAll(true)}>
          {[
            `+${rest.length} more route${rest.length === 1 ? "" : "s"} with changes`,
            ...(["proposed", "edit"] as const).flatMap((field) => {
              const n = rest.reduce((total, counts) => total + counts[field], 0);
              return n ? [`${n} ${field}`] : [];
            }),
          ].join(" · ")}
        </Button>
      ) : null}
    </div>
  );
}
/** One line per Work, read left to right (chat polish round 2, 2026-10-12): the review toggle names
 *  what is edit and how much in words · where, with the revision as the one machine value · the
 *  one commit. Narrow, the line wraps rather than truncates, and the subject is the last thing to
 *  give way; the commit carries the route's refusal, which `ProposalHead` says once per route. */
function WorkLine({ parts }: { parts: HeadWork[] }) {
  const [open, setOpen] = useState(false);
  const work = parts[0]!;
  const groups = parts.map(headGroups);
  const counts = tally(groups.flat());
  const pendingEdits = new Map(
    parts.flatMap((part) => (part.pending ?? []).map((edit) => [edit.press, edit] as const)),
  );
  return (
    <div className="flex flex-col" data-work={work.id}>
      <div className="flex min-h-(--control-h) min-w-0 flex-wrap items-center gap-x-2">
        <Button
          kind="framed"
          aria-expanded={open}
          // The e2e journeys press this by name (`review ▾`); the face says what is edit.
          label={`review ${open ? "▴" : "▾"}`}
          reason="Show the changes by group"
          onClick={() => setOpen(!open)}
        >
          <ChevronRight
            aria-hidden
            className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="min-w-0">
            <b className="whitespace-nowrap">{work.subject}</b>
            <span className="text-ink-2">
              {" · "}
              <Counts {...counts} />
            </span>
          </span>
        </Button>
        <span className="whitespace-nowrap text-ink-2">
          in {work.route} ·{" "}
          <span className="face-mono">
            {work.wire.revision === null ? "unwritten" : `r${work.wire.revision}`}
          </span>
          {work.stale ? " · stale" : ""}
          {work.conflict ? " · changed elsewhere" : ""}
        </span>
        {work.conflict && work.reload ? (
          <Button kind="framed" label="reload" onClick={work.reload}>
            reload
          </Button>
        ) : null}
        {[...pendingEdits.values()].map((edit) => (
          <span key={edit.press} className="flex items-center gap-1">
            <span data-tone="caution">unaccepted edit</span>
            <Button
              kind="framed"
              label="retry edit"
              refusal={work.conflict ? "Reload Work first" : null}
              onClick={() => void edit.retry()}
            >
              retry
            </Button>
            <Button kind="framed" label="discard edit" onClick={edit.discard}>
              discard
            </Button>
          </span>
        ))}
        <span className="ml-auto">
          <Button
            kind="framed"
            label={work.commit.word}
            reason={COMMIT_REASON}
            refusal={work.refusal ?? (counts.edit ? null : "nothing edit")}
            onClick={work.commit.run}
          >
            {work.commit.word}
          </Button>
        </span>
      </div>
      {open
        ? parts.map((part, index) => <Groups key={part.id} work={part} groups={groups[index]!} />)
        : null}
    </div>
  );
}
function Groups({ work, groups }: { work: HeadWork; groups: CellGroup[] }) {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, FanOutOutcome>>(new Map());
  const more = groups.length - GROUP_ROWS;
  // One pass over the Work's pending cells per change, not one per group per render.
  const keysOf = useMemo(() => {
    const byPath = new Map<string, string[]>();
    for (const [key, cell] of Object.entries(work.cells)) {
      if (!pending(cell)) continue;
      const path = JSON.stringify(work.groupOf(key));
      byPath.set(path, [...(byPath.get(path) ?? []), key]);
    }
    return byPath;
  }, [work.cells, work.groupOf]);
  return (
    <div className="flex flex-col pl-4">
      {groups.slice(0, GROUP_ROWS).map((group) => {
        const path = JSON.stringify(group.path);
        return (
          <GroupRow
            key={path}
            work={work}
            group={group}
            keys={keysOf.get(path) ?? NO_KEYS}
            outcome={outcomes.get(path)}
            done={(outcome) => setOutcomes(new Map(outcomes).set(path, outcome))}
          />
        );
      })}
      {more > 0 ? (
        <Button
          kind="nav"
          direction="forward"
          label={`open ${more} more group${more === 1 ? "" : "s"} in ${work.route}`}
          onClick={() => work.open()}
        >
          … {more} more group{more === 1 ? "" : "s"} · open in {work.route}
        </Button>
      ) : null}
    </div>
  );
}
const NO_KEYS: string[] = [];
function GroupRow({
  work,
  group,
  keys,
  outcome,
  done,
}: {
  work: HeadWork;
  group: CellGroup;
  keys: string[];
  outcome: FanOutOutcome | undefined;
  done: (outcome: FanOutOutcome) => void;
}) {
  const show = work.show ?? showDefault;
  const label = JSON.stringify(group.path);
  const words = group.path.map((part) => work.label?.(part) ?? part).join(" · ");
  // `{k}` is what the press would cover over these cells, bound to this revision. The dry runs
  // are memoized: they rerun only when the cells, the group's keys or the locks move.
  const { segment, lockOf } = work.wire;
  const { acceptK, denyK } = useMemo(() => {
    const ctx = {
      cellsPath: segment === null ? [] : [segment],

      lockOf,
    };
    return {
      acceptK: fanOut(work.cells, keys, "take", ctx).covered.length,
      denyK: fanOut(work.cells, keys, "unsuggest", ctx).covered.length,
    };
  }, [work.cells, keys, segment, lockOf]);
  const to = (value: unknown) => (value === null ? "delete" : show(value));
  const digest = group.digest;
  // `summarize` dedupes whole values, and a families value carries its familyName: "J1 hold2" on
  // three families is three values there. The person reads what `show` draws, so the head counts
  // distinct values by that, over the same cells the digest tallies (open, unstaged, unlocked).
  // ponytail: a recount over the group's keys; move into `summarize` if it takes a value projection.
  const shown = useMemo(() => {
    const seen = new Set<string>();
    for (const key of keys) {
      const cell = work.cells[key];
      if (!cell?.suggestion || cell.edit != null || lockOf?.(key)) continue;
      seen.add(to(cell.suggestion.delete === true ? null : cell.suggestion.value));
    }
    return [...seen];
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `to` is `show`, the Work's own formatter
  }, [work.cells, keys, lockOf, show]);
  const body =
    digest && "single" in digest
      ? `${digest.single.from !== undefined ? `${show(digest.single.from)} ` : ""}→ ${to(digest.single.to)}`
      : digest && shown.length === 1
        ? `→ ${shown[0]}`
        : digest
          ? `${shown.length} values (e.g. ${shown.slice(0, EXAMPLES).join(", ")})`
          : group.proposed
            ? null
            : group.contested
              ? `${group.contested} contested — resolve in ${work.route}`
              : [
                  ...new Set(
                    keys.flatMap((key) => {
                      const edit = work.cells[key]?.edit;
                      return edit ? [to(edit.delete === true ? null : edit.value)] : [];
                    }),
                  ),
                ]
                  .slice(0, EXAMPLES)
                  .join(" · ");
  const facts = [
    group.proposed ? `${group.span} cells` : null,
    group.proposed && group.contested ? `${group.contested} contested` : null,
    group.locked ? `${group.locked} locked` : null,
  ].filter(Boolean);
  const verbs = group.proposed > 0;
  const act = (kind: "take" | "unsuggest") =>
    void runFanOut(work.wire, work.cells, keys, kind).then(done);
  return (
    <div className="flex flex-col" data-group={label}>
      <div className="grid h-(--item-h) grid-cols-[minmax(6rem,12rem)_minmax(0,1fr)_auto] items-center gap-2">
        <TooltipHint content={words}>
          <span className="truncate">{words}</span>
        </TooltipHint>
        <TooltipHint content={[body, ...facts].filter(Boolean).join(" · ")}>
          <span className="truncate face-mono">
            {body}
            {facts.length ? (
              <span className="text-ink-2">
                {body ? " · " : ""}
                {facts.join(" · ")}
              </span>
            ) : null}
          </span>
        </TooltipHint>
        <span className="flex items-center gap-1">
          {verbs && acceptK ? (
            <TooltipHint
              content={`Stage Pea's suggestion on ${acceptK} cells in one write; contested and locked cells are skipped`}
            >
              <Verdict kind="take" aria-label={`accept ${acceptK}`} onClick={() => act("take")}>
                {acceptK}
              </Verdict>
            </TooltipHint>
          ) : null}
          {verbs && denyK ? (
            <TooltipHint content={`Clear Pea's suggestion on ${denyK} cells in one write`}>
              <Verdict
                kind="unsuggest"
                aria-label={`deny ${denyK}`}
                onClick={() => act("unsuggest")}
              >
                {denyK}
              </Verdict>
            </TooltipHint>
          ) : null}
          <UnstageAll wire={work.wire} cells={work.cells} keys={keys} done={done} compact />
          <Button
            kind="nav"
            direction="forward"
            label={`review ${words} in ${work.route}`}
            reason={`Open ${words} in ${work.route}, on its row`}
            onClick={() => work.open(keys[0])}
          >
            review
          </Button>
        </span>
      </div>
      {outcome ? (
        <TooltipHint content={outcome.refusal ? "nothing was written" : undefined}>
          <span className="truncate pl-2" data-tone={outcome.refusal ? "caution" : "done"}>
            {fanOutWord(outcome)}
          </span>
        </TooltipHint>
      ) : null}
    </div>
  );
}
