/**
 * THE CHAT HEAD'S PROPOSAL SUMMARY (journeys chat-summary spec): live asks, then one line per Work
 * the thread's document holds, counts only. `review ▾` expands one Work into at most five groups
 * from the contract's `summarize`; a group's accept and deny are `fanOut`s of the same cell
 * transitions the route draws on each cell. Every exit opens the route in Chat's plugin pane.
 * It never lists cells and never draws a confirmation sheet.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { fanOut, summarize, type CellGroup, type TrichotomyCellLike } from "@pe/agent-contracts";

import { ActionButton } from "#/components/lang/action-button";
import {
  fanOutWord,
  runFanOut,
  UnstageAll,
  type CellWire,
  type FanOutOutcome,
} from "#/components/lang/band";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";

export interface HeadWork {
  id: string;
  /** The route title, e.g. "Families". */
  route: string;
  /** The Work's entity, or the document name for a document-wide route. */
  subject: string;
  cells: Record<string, TrichotomyCellLike>;
  /** How the cells are written; bound kinds carry `wire.revision`, the rendered revision. */
  wire: CellWire;
  /** The route's full group path for a key; the head reads depth 1. */
  groupOf: (key: string) => string[];
  /** The route's own value formatter. */
  show?: (value: unknown) => string;
  stale?: boolean;
  /** A foreign write refused this Work's last bound write. */
  conflict?: boolean;
  reload?: () => void;
  /** The route's commit word ("plan"); pressing it opens the pane unscoped and runs it there. */
  commit: { word: string; run: () => void };
  /** Open the route in the plugin pane, scoped to a group path or unscoped. */
  open: (focus?: readonly string[]) => void;
  /** Works sharing a line are one Work in two segments: one head line, one commit (F-B-4). */
  line?: string;
  /** The head's plan, refused where it ran; said here, where it was pressed (F-B-5). */
  refusal?: string;
}

const REST_WORKS = 3;
const GROUP_ROWS = 5;
const EXAMPLES = 2;
export const COMMIT_REASON =
  "Open the plan in the pane — staging is not applying; the confirmation lists every change before Revit changes";

const pending = (cell: TrichotomyCellLike) => cell.proposal != null || cell.staged != null;
const showDefault = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** Depth-1 groups, contested first, then by pending size, then label. */
export function headGroups(work: Pick<HeadWork, "cells" | "groupOf" | "wire">): CellGroup[] {
  const { groups } = summarize(work.cells, {
    groupOf: (key) => work.groupOf(key).slice(0, 1),
    baselineOf: (key) => work.wire.baselineOf?.(key),
    lockOf: work.wire.lockOf,
  });
  return groups.sort(
    (a, b) =>
      Number(b.contested > 0) - Number(a.contested > 0) ||
      b.proposed + b.staged - (a.proposed + a.staged) ||
      String(a.path[0]).localeCompare(String(b.path[0])),
  );
}

/** `{P} proposed · {S} staged · {C} contested`, zeros omitted. */
export function countWords(
  groups: readonly Pick<CellGroup, "proposed" | "staged" | "contested">[],
) {
  const sum = (field: "proposed" | "staged" | "contested") =>
    groups.reduce((total, group) => total + group[field], 0);
  return { proposed: sum("proposed"), staged: sum("staged"), contested: sum("contested") };
}

function Counts({ proposed, staged, contested }: ReturnType<typeof countWords>) {
  const parts: ReactNode[] = [];
  if (proposed)
    parts.push(
      <span key="p" data-tone="pea">
        {proposed} proposed
      </span>,
    );
  if (staged) parts.push(<span key="s">{staged} staged</span>);
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
  for (const work of works.filter((one) => Object.values(one.cells).some(pending)))
    lines.set(work.line ?? work.id, [...(lines.get(work.line ?? work.id) ?? []), work]);
  const live = [...lines.values()];
  if (!asks.length && !live.length) return null;
  const shown = all || live.length <= REST_WORKS ? live : live.slice(0, REST_WORKS);
  const rest = live.slice(shown.length).map((parts) => countWords(parts.flatMap(headGroups)));
  return (
    <div aria-label="Pea proposals" className="hairline-t hairline-b flex flex-col py-1 t-prose">
      {asks}
      {shown.map((parts) => (
        <WorkLine key={parts[0]!.id} parts={parts} />
      ))}
      {rest.length ? (
        <Press tone="quiet" size="value" onClick={() => setAll(true)}>
          {[
            `+${rest.length} more route${rest.length === 1 ? "" : "s"} with changes`,
            ...(["proposed", "staged"] as const).flatMap((field) => {
              const n = rest.reduce((total, counts) => total + counts[field], 0);
              return n ? [`${n} ${field}`] : [];
            }),
          ].join(" · ")}
        </Press>
      ) : null}
    </div>
  );
}

function WorkLine({ parts }: { parts: HeadWork[] }) {
  const [open, setOpen] = useState(false);
  const work = parts[0]!;
  const groups = parts.map(headGroups);
  const counts = countWords(groups.flat());
  return (
    <div className="flex flex-col" data-work={work.id}>
      <div className="flex flex-wrap items-baseline gap-x-3 py-0.5">
        <span className="truncate">
          <b>{work.route}</b> · {work.subject}
        </span>
        <Counts {...counts} />
        <span className="t-small face-mono text-ink-2">
          {work.wire.revision === null ? "unwritten" : `r${work.wire.revision}`}
          {work.stale ? " · stale" : ""}
          {work.conflict ? " · changed elsewhere" : ""}
        </span>
        {work.conflict && work.reload ? (
          <Press tone="quiet" size="value" onClick={work.reload}>
            reload
          </Press>
        ) : null}
        <span className="ml-auto flex items-baseline gap-2">
          <Press tone="quiet" size="value" aria-expanded={open} onClick={() => setOpen(!open)}>
            review {open ? "▴" : "▾"}
          </Press>
          <ActionButton
            label={`${work.commit.word}${work.wire.revision === null ? "" : ` r${work.wire.revision}`}`}
            reason={counts.staged ? COMMIT_REASON : "nothing staged"}
            disabled={!counts.staged}
            onClick={work.commit.run}
          />
        </span>
      </div>
      {work.refusal ? (
        <OutcomeLine kind="refused" label={`${work.commit.word} refused`} says={work.refusal} />
      ) : null}
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
    const byLabel = new Map<string, string[]>();
    for (const [key, cell] of Object.entries(work.cells)) {
      if (!pending(cell)) continue;
      const label = String(work.groupOf(key)[0]);
      byLabel.set(label, [...(byLabel.get(label) ?? []), key]);
    }
    return byLabel;
  }, [work.cells, work.groupOf]);
  return (
    <div className="flex flex-col pl-4">
      {groups.slice(0, GROUP_ROWS).map((group) => {
        const label = String(group.path[0]);
        return (
          <GroupRow
            key={label}
            work={work}
            group={group}
            keys={keysOf.get(label) ?? NO_KEYS}
            outcome={outcomes.get(label)}
            done={(outcome) => setOutcomes(new Map(outcomes).set(label, outcome))}
          />
        );
      })}
      {more > 0 ? (
        <Press tone="nav" size="value" onClick={() => work.open()}>
          … {more} more group{more === 1 ? "" : "s"} · open in {work.route} ›
        </Press>
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
  const label = String(group.path[0]);
  // `{k}` is what the press would cover over these cells, bound to this revision. The dry runs
  // are memoized: they rerun only when the cells, the group's keys or the locks move.
  const { segment, lockOf } = work.wire;
  const { acceptK, denyK } = useMemo(() => {
    const ctx = {
      cellsPath: segment === null ? [] : [segment],
      actor: "human" as const,
      lockOf,
    };
    return {
      acceptK: fanOut(work.cells, keys, "accept", ctx).covered.length,
      denyK: fanOut(work.cells, keys, "deny", ctx).covered.length,
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
      if (!cell?.proposal || cell.staged != null || lockOf?.(key)) continue;
      seen.add(to(cell.proposal.delete === true ? null : cell.proposal.value));
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
              : `${group.staged} staged`;
  const facts = [
    group.proposed ? `${group.span} cells` : null,
    group.proposed && group.contested ? `${group.contested} contested` : null,
    group.locked ? `${group.locked} locked` : null,
  ].filter(Boolean);
  const verbs = group.proposed > 0;
  const act = (kind: "accept" | "deny") =>
    void runFanOut(work.wire, work.cells, keys, kind).then(done);
  return (
    <div className="flex flex-col" data-group={label}>
      <div className="flex flex-wrap items-baseline gap-x-3 py-0.5">
        <span className="w-[9rem] truncate">{label}</span>
        {body ? <span className="truncate face-mono">{body}</span> : null}
        {facts.length ? <span className="t-small text-ink-2">{facts.join(" · ")}</span> : null}
        <span className="ml-auto flex items-baseline gap-1">
          {verbs && acceptK ? (
            <ActionButton
              tone="agent"
              icon={Check}
              label={`accept ${acceptK}`}
              reason={`Stage Pea's proposal on ${acceptK} cells in one write; contested and locked cells are skipped`}
              onClick={() => act("accept")}
            />
          ) : null}
          {verbs && denyK ? (
            <ActionButton
              icon={X}
              label={`deny ${denyK}`}
              reason={`Clear Pea's proposal on ${denyK} cells in one write`}
              onClick={() => act("deny")}
            />
          ) : null}
          <UnstageAll wire={work.wire} cells={work.cells} keys={keys} done={done} />
          <Press
            tone="nav"
            size="value"
            aria-label={`open ${label} in ${work.route}`}
            onClick={() => work.open(group.path)}
          >
            ›
          </Press>
        </span>
      </div>
      {outcome ? (
        <OutcomeLine
          kind={outcome.refusal ? "refused" : "receipt"}
          label={fanOutWord(outcome)}
          says={outcome.refusal ? "nothing was written" : undefined}
        />
      ) : null}
    </div>
  );
}
