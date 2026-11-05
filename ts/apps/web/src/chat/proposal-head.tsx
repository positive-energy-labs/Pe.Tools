import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { type CellGroup, type CellLike } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import {
  clearWord,
  tally,
  UnstageAll,
  workSummary,
  type CellWire,
  type ClearOutcome,
} from "#/components/work/band";
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
const pending = (cell: CellLike) => cell.edit != null;
const showDefault = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

function headGroups(work: Pick<HeadWork, "cells" | "groupOf" | "wire">): CellGroup[] {
  const { groups } = workSummary(work.cells, {
    ...work.wire,
    groupOf: work.groupOf,
  });
  return groups.sort(
    (a, b) => b.staged - a.staged || JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)),
  );
}
function Counts({ staged, byPea }: ReturnType<typeof tally>) {
  return (
    <span>
      {staged} staged · {byPea} by Pea
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
      aria-label="Staged cells"
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
            ...(["staged", "byPea"] as const).flatMap((field) => {
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
            refusal={work.refusal ?? (counts.staged ? null : "nothing edit")}
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
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ClearOutcome>>(new Map());
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
  outcome: ClearOutcome | undefined;
  done: (outcome: ClearOutcome) => void;
}) {
  const show = work.show ?? showDefault;
  const label = JSON.stringify(group.path);
  const words = group.path.map((part) => work.label?.(part) ?? part).join(" · ");
  const digest = group.digest;
  const to = (value: unknown) => (value === null ? "delete" : show(value));
  const body =
    digest && "single" in digest
      ? `${digest.single.from !== undefined ? `${show(digest.single.from)} → ` : ""}${to(digest.single.to)}`
      : digest
        ? `${digest.many.count} values (e.g. ${digest.many.examples.slice(0, EXAMPLES).map(to).join(", ")})`
        : "";
  const facts = [
    `${group.staged} staged`,
    `${group.byPea} by Pea`,
    ...(group.locked ? [`${group.locked} locked`] : []),
  ];
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
            {clearWord(outcome)}
          </span>
        </TooltipHint>
      ) : null}
    </div>
  );
}
