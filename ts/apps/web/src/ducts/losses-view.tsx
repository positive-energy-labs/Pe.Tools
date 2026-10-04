/**
 * The losses view (`page.view = "losses"`): the grille is the unit (pressure-drop ledger, F). Per
 * group, one bar per terminal segmented by what eats the pressure; the longest is the fan. Pe's
 * fan sits beside Revit's critical path in the group head. Opening a terminal draws its drawer:
 * the rules on its path with their table chips, its terminal drop and the components on it.
 * A chip or a number STAGES a Work cell; nothing reaches Revit until preview and apply. The bars
 * show what Revit holds now and ghost to the staged state, as the staged band does (variant J).
 */
import { Fragment, useMemo, useState } from "react";
import type { DuctsApply } from "@pe/host-contracts/generated";
import {
  transitionPatches,
  type DuctDrop,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { cellFromTrichotomy, StateCell } from "#/components/lang/cell";
import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { Row as ListRow } from "#/components/lang/row";
import { Switcher } from "#/components/lang/switcher";
import { ValueDiff } from "#/components/lang/value-diff";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import type { DuctsEvaluation, DuctsPage } from "./manifest";
import { LOSS_RULES, ruleByKey } from "./loss-rules";
import type { LossResult, Row } from "./losses";
import { systemFor } from "./losses";
import {
  instancesOf,
  partOf,
  PARTS,
  stagedFanout,
  tableOf,
  unpriced,
  type Part,
  type Priced,
} from "./pricing";
import type { Grids } from "./loss-grid";
import type { DuctSnapshot, GroupReadiness } from "./readiness";

type Node = DuctSnapshot["nodes"][number];
type Group = DuctSnapshot["groups"][number];
export interface LossesWork {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  /** The last preview's answer: a write it refused says why at its cell. */
  preview?: DuctsApply.Res.Response | null;
  write: CellWire["write"];
}

/** One viz hue per part, as a class: the bar and the chip wear the same one. */
const PART_BG: Record<Part, string> = {
  friction: "bg-(--viz-6)",
  elbow: "bg-(--viz-1)",
  tap: "bg-(--viz-2)",
  transition: "bg-(--viz-3)",
  damper: "bg-(--viz-4)",
  terminal: "bg-(--viz-5)",
};
const fmt = (n: number | null | undefined) => (n == null ? "" : n.toFixed(4));
const fmtC = (n: number) => n.toFixed(2);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "");
const NO_ROOT = "no air mover; priced from the open end";

/** Why this grille's number is not yet Revit's too: the word, and what it means. The group-wide
 * reasons (no mover, engine flag off) are said once in the group head, never per row. */
const STATUS = {
  "open-end": ["open end", "an open end on this path is not answered (capped or ignored)"],
  refuses: ["drop refused", "the connector is not Specific Loss; Revit refuses a terminal drop"],
  "no-drop": ["no drop", "no terminal drop is known; stage one from the catalog"],
} as const;
type Status = keyof typeof STATUS;

export function terminalStatus(
  snapshot: DuctSnapshot,
  ready: GroupReadiness | undefined,
  node: Node,
  priced: Priced,
): Status[] {
  const issues = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
  const out: Status[] = [];
  if (ready?.walk.some((id) => issues.get(id)?.kind === "open-end")) out.push("open-end");
  if (node.terminalDrop && !node.terminalDrop.writable) out.push("refuses");
  const terminal = priced.next.paths[node.id]?.rows.find((row) => row.kind === "terminal");
  if (terminal?.error) out.push("no-drop");
  return out;
}

/** Stage a rule's table; staging the table already staged takes it back. */
export const tablePatches = (
  doc: DuctsRouteDocument | null,
  key: string,
  table: string,
): RouteStatePatch[] => {
  const cell = doc?.rules[key] ?? {};
  return cell.staged?.value.table === table
    ? transitionPatches(["rules"], key, cell, { kind: "unstage" })
    : transitionPatches(["rules"], key, cell, { kind: "stage", rung: { value: { table } } });
};

function DropCell({
  segment,
  id,
  held,
  work,
  label,
}: {
  segment: "terminalDrops" | "componentDrops";
  id: number;
  held: number | null | undefined;
  work: LossesWork;
  label: string;
}) {
  const key = String(id);
  const cell = work.doc?.[segment][key] ?? {};
  const kind = segment === "terminalDrops" ? "terminal" : "component";
  const refusal = work.preview?.writes.find(
    (w) => w.kind === kind && w.id === id && w.outcome === "refused",
  );
  const authored = (cell.staged ?? cell.proposal)?.value as DuctDrop | undefined;
  const wire: CellWire = { segment, revision: work.revision, write: work.write };
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" aria-label={label}>
      <StateCell
        {...cellFromTrichotomy(cell, {
          value: authored ? String(authored.inWg) : held == null ? "" : String(held),
          cap: "editable",
          note: authored && held != null ? `Revit holds ${held}` : undefined,
        })}
        scale="row"
        numeric={{ min: 0, digits: 4 }}
        placeholder="—"
        onCommit={(text: string) =>
          work
            .write(
              transitionPatches([segment], key, cell, {
                kind: "stage",
                rung: {
                  value: {
                    inWg: Number(text),
                    ...(authored?.source ? { source: authored.source } : {}),
                  },
                },
              }),
            )
            .then((refusal) => refusal?.message)
        }
        transitions={reviewTransitions(wire, key, cell)}
        refused={
          refusal ? `preview: Revit refuses this drop: ${refusal.reason ?? "no reason"}` : undefined
        }
      />
    </span>
  );
}

function Chips({ ruleKey, priced, work }: { ruleKey: string; priced: Priced; work: LossesWork }) {
  const rule = ruleByKey(ruleKey)!;
  const staged = priced.staged.rules[ruleKey]?.table.toUpperCase();
  if (rule.options.length === 1) return <span className="face-mono">{rule.options[0]}</span>;
  // The fill is the table every instance is looked up under now; a staged one also wears caution.
  // Picking the staged table again takes it back (`tablePatches`).
  return (
    <Switcher
      ariaLabel={`${rule.family} : ${rule.type} table`}
      value={tableOf(priced, ruleKey)}
      onChange={(table) => void work.write(tablePatches(work.doc, ruleKey, table))}
      options={rule.options.map((table) => ({
        value: table,
        label:
          staged === table ? (
            <span data-tone="caution" data-staged-table={table}>
              {table}
            </span>
          ) : (
            table
          ),
        title:
          staged === table
            ? `${table} is staged for every ${rule.family} : ${rule.type}; pick it again to take it back`
            : `Stage ${table} for every ${rule.family} : ${rule.type}${rule.cond ? ` (${rule.cond})` : ""}`,
      }))}
    />
  );
}

/** One drawer row: a rule on this path, the path's straight duct, a component, the terminal, or a rule's instance list. */
type DrawerRow =
  | { kind: "rule"; key: string; rows: Row[] }
  | { kind: "instances"; key: string }
  | { kind: "friction"; rows: Row[] }
  | { kind: "component"; row: Row }
  | { kind: "terminal"; rows: Row[] };
const rowId = (row: DrawerRow) =>
  row.kind === "rule" || row.kind === "instances"
    ? `${row.kind}:${row.key}`
    : row.kind === "component"
      ? `component:${row.row.id}`
      : row.kind;

function Drawer({
  snapshot,
  priced,
  terminal,
  work,
}: {
  snapshot: DuctSnapshot;
  priced: Priced;
  terminal: number;
  work: LossesWork;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const nodes = useMemo(() => new Map(snapshot.nodes.map((n) => [n.id, n])), [snapshot]);
  const segments = useMemo(() => new Map(snapshot.segments.map((s) => [s.id, s])), [snapshot]);
  const path = priced.next.paths[terminal];
  const node = nodes.get(terminal);
  const columns = useMemo<Column<DrawerRow>[]>(() => {
    const total = path?.total ?? 0;
    const sum = (list: Row[]) => list.reduce((a, row) => a + row.dp, 0);
    const own = (row: DrawerRow): Row[] =>
      row.kind === "component" ? [row.row] : row.kind === "instances" ? [] : row.rows;
    const revitOf = (ids: Iterable<number>) => {
      let at: number | null = null;
      for (const id of new Set(ids)) {
        const v =
          nodes.get(id)?.loss?.revitPressureDropInWg ?? segments.get(id)?.revit.pressureDropInWg;
        if (v != null) at = (at ?? 0) + v;
      }
      return at;
    };
    const revit = (row: DrawerRow) =>
      row.kind === "terminal"
        ? node?.terminalDrop?.assignedPressureDropInWg
        : revitOf(own(row).map((r) => r.id));
    const mono = "block px-(--item-pad-x) text-right face-mono whitespace-nowrap";
    return [
      {
        key: "part",
        label: "part",
        width: "w-24",
        cell: (row) => {
          const first = own(row)[0];
          return row.kind === "instances" || !first ? null : (
            <PartChip part={partOf(first, nodes.get(first.id))} />
          );
        },
      },
      {
        key: "rule",
        label: "rule",
        title: "family : type · condition; every instance matching it shares one table",
        width: "w-[26rem] max-w-[26rem]",
        cell: (row) => {
          if (row.kind === "rule") {
            const rule = ruleByKey(row.key)!;
            const missing = unpriced(priced, row.key);
            return (
              <span
                className="block truncate px-(--item-pad-x)"
                data-rule={row.key}
                title={`${rule.family} : ${rule.type}${rule.cond ? ` · ${rule.cond}` : ""}`}
              >
                {rule.family} : {rule.type}
                {rule.cond ? <span className="text-ink-2"> · {rule.cond}</span> : null}
                {missing ? (
                  <span data-tone="caution">
                    {" "}
                    · {missing} with no value under {tableOf(priced, row.key)}
                  </span>
                ) : null}
              </span>
            );
          }
          if (row.kind === "instances")
            return (
              <span className="block truncate px-(--item-pad-x) face-mono" data-instances={row.key}>
                {[...instancesOf(priced.next, row.key).values()]
                  .map((r) => `${r.id} ${r.c == null ? (r.error ?? "—") : fmt(r.c)}`)
                  .join(" · ")}
              </span>
            );
          if (row.kind === "friction")
            return (
              <span className="block px-(--item-pad-x)">
                straight duct, {new Set(row.rows.map((r) => r.id)).size} runs
              </span>
            );
          if (row.kind === "component")
            return (
              <span className="block truncate px-(--item-pad-x)" data-component={row.row.id}>
                {nodes.get(row.row.id)?.family ?? row.row.desc}
                {row.row.error ? <span data-tone="caution"> · {row.row.error}</span> : null}
              </span>
            );
          return (
            <span className="block truncate px-(--item-pad-x)" data-terminal-row={terminal}>
              {node?.family ?? "terminal"} : {node?.type ?? ""}
            </span>
          );
        },
      },
      {
        key: "table",
        label: "table / drop (in-wg)",
        title:
          "the ASHRAE table a rule is looked up under, or the drop a terminal or component holds",
        width: "whitespace-nowrap",
        cell: (row) =>
          row.kind === "rule" ? (
            <Chips ruleKey={row.key} priced={priced} work={work} />
          ) : row.kind === "component" ? (
            <DropCell
              segment="componentDrops"
              id={row.row.id}
              held={nodes.get(row.row.id)?.loss?.revitPressureDropInWg}
              work={work}
              label={`component ${row.row.id} drop`}
            />
          ) : row.kind === "terminal" ? (
            <DropCell
              segment="terminalDrops"
              id={terminal}
              held={
                node?.terminalDrop?.catalogDropInWg ?? node?.terminalDrop?.assignedPressureDropInWg
              }
              work={work}
              label={`terminal ${terminal} drop`}
            />
          ) : null,
      },
      {
        key: "n",
        label: "n",
        width: "w-10",
        title: "distinct fittings the rule prices; press to list them",
        cell: (row) =>
          row.kind !== "rule" ? null : (
            <Press
              size="caption"
              tone="quiet"
              title="show the instances under this rule"
              onClick={() =>
                setOpen((was) => {
                  const next = new Set(was);
                  if (!next.delete(row.key)) next.add(row.key);
                  return next;
                })
              }
            >
              {instancesOf(priced.next, row.key).size}
            </Press>
          ),
      },
      {
        key: "c",
        label: "C",
        title: "loss coefficient across the rule's instances on this path (lowest – highest)",
        width: "w-28",
        cell: (row) => {
          if (row.kind !== "rule") return null;
          const cs = [...instancesOf(priced.next, row.key).values()].flatMap((r) =>
            r.c == null ? [] : [r.c],
          );
          const lo = Math.min(...cs);
          const hi = Math.max(...cs);
          return (
            <span className={mono}>
              {cs.length ? (lo === hi ? fmtC(lo) : `${fmtC(lo)} – ${fmtC(hi)}`) : "—"}
            </span>
          );
        },
      },
      {
        key: "dp",
        label: "Δp",
        width: "w-20",
        title: "in-wg on this grille's path",
        cell: (row) => <span className={mono}>{fmt(sum(own(row))) || ""}</span>,
      },
      {
        key: "share",
        label: "share",
        title: "of this grille's total",
        width: "w-12",
        cell: (row) => <span className={mono}>{pct(sum(own(row)), total)}</span>,
      },
      {
        key: "revit",
        label: "Revit",
        width: "w-20",
        title: "Revit's own reported drop on the same elements; a check, never an input",
        cell: (row) => <span className={`${mono} text-ink-2`}>{fmt(revit(row))}</span>,
      },
    ];
  }, [nodes, segments, node, path, priced, terminal, work]);
  if (!path) return null;
  const rows = path.rows;
  const keys = [...new Set(rows.flatMap((row) => (row.rule ? [row.rule] : [])))];
  const friction = rows.filter((row) => row.kind === "friction");
  const drawer: DrawerRow[] = [
    ...keys.flatMap((key): DrawerRow[] => [
      { kind: "rule", key, rows: rows.filter((row) => row.rule === key) },
      ...(open.has(key) ? [{ kind: "instances" as const, key }] : []),
    ]),
    ...(friction.length ? [{ kind: "friction" as const, rows: friction }] : []),
    ...rows
      .filter((row) => row.kind === "fitting" && !row.rule)
      .map((row) => ({ kind: "component" as const, row })),
    { kind: "terminal", rows: rows.filter((row) => row.kind === "terminal") },
  ];
  return (
    <div className="ml-6 mb-2" data-drawer={terminal}>
      <Table
        label={`rules on grille ${terminal}'s path`}
        rows={drawer}
        columns={columns}
        rowKey={rowId}
        maxHeight="24rem"
      />
    </div>
  );
}

const PartChip = ({ part }: { part: Part }) => (
  <span className="inline-flex items-center gap-1 t-small face-mono">
    <span className={`inline-block size-2 ${PART_BG[part]}`} />
    {part}
  </span>
);

/**
 * Revit's critical path as a word. With the engine flag off Revit reports 0 for every system,
 * which is not an answer, so the flag is named instead of the zero.
 */
export const revitSays = (snapshot: DuctSnapshot, inWg: number | null | undefined) =>
  !snapshot.document.networkBasedCalculations ? "engine off" : inWg == null ? "no path" : fmt(inWg);

/** Pe's fan beside Revit's critical path, with the staged fan when it differs. */
function GroupHead({
  snapshot,
  group,
  priced,
}: {
  snapshot: DuctSnapshot;
  group: Group;
  priced: Priced;
}) {
  const now = priced.now.byGroup[group.id];
  const next = priced.next.byGroup[group.id];
  const critical = now?.critical ?? null;
  const revit = critical == null ? null : systemFor(snapshot, critical);
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-1" data-group-head={group.id}>
      <span className="t-title">
        {group.id} · {group.systemNames.slice(0, 3).join(", ") || "no system"}
      </span>
      <span className="inline-flex items-baseline gap-1">
        <span className="t-small t-upper text-ink-2">fan static</span>
        <span className="t-small text-ink-2">Pe</span>
        <b className="face-mono" data-fan={group.id}>
          {fmt(now?.fan)}
        </b>
        {next && now && Math.abs(next.fan - now.fan) > 1e-9 ? (
          <span data-tone="caution" data-fan-next={group.id}>
            <ValueDiff from="" to={fmt(next.fan)} />
          </span>
        ) : null}
        <span className="t-small text-ink-2">in-wg · Revit</span>
        <span className="face-mono" data-revit={group.id}>
          {revitSays(snapshot, revit?.criticalPathLossInWg)}
        </span>
      </span>
      <span className="t-small text-ink-2">
        critical <span className="face-mono">{critical ?? "—"}</span>
      </span>
      {group.rootIds.length === 0 ? (
        <span className="t-small" data-tone="caution">
          {NO_ROOT}
        </span>
      ) : null}
    </div>
  );
}

function Bars({
  snapshot,
  group,
  ready,
  priced,
  max,
  page,
  setPage,
  work,
}: {
  snapshot: DuctSnapshot;
  group: Group;
  ready: GroupReadiness | undefined;
  priced: Priced;
  max: number;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  work: LossesWork;
}) {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const terminals = Object.entries(priced.now.paths)
    .filter(([, path]) => path.groupId === group.id)
    .map(([id, path]) => ({ id: Number(id), path }))
    .sort((a, b) => b.path.total - a.path.total);
  const critical = priced.now.byGroup[group.id]?.critical;
  return (
    <div>
      {terminals.map(({ id, path }) => {
        const node = nodes.get(id)!;
        const by = new Map<Part, number>();
        for (const row of path.rows) {
          const part = partOf(row, nodes.get(row.id));
          by.set(part, (by.get(part) ?? 0) + row.dp);
        }
        const next = priced.next.paths[id]?.total ?? path.total;
        const moved = Math.abs(next - path.total) > 1e-9;
        const statuses = terminalStatus(snapshot, ready, node, priced);
        const opened = page.selected === String(id);
        return (
          <Fragment key={id}>
            <ListRow
              data-key={String(id)}
              active={opened}
              title={opened ? "close this grille's rules" : "open this grille's rules"}
              onClick={() => setPage({ selected: opened ? "" : String(id) })}
              label={
                <span className="flex items-center gap-2" data-terminal={id}>
                  <span className="w-56 shrink-0 truncate">
                    <span className="face-mono">{id}</span> {node.family ?? ""} ·{" "}
                    {Math.round(node.facts.find((f) => f.key === "flow")?.value ?? 0)} cfm
                  </span>
                  <span className="relative flex h-4 flex-1 bg-(--pe-recess)">
                    {PARTS.filter((part) => by.get(part)).map((part) => (
                      <span
                        key={part}
                        data-part={part}
                        className={PART_BG[part]}
                        style={{ width: `${(by.get(part)! / max) * 100}%` }}
                        title={`${part}: ${fmt(by.get(part))} (${pct(by.get(part)!, path.total)})`}
                      />
                    ))}
                    {moved ? (
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 dash-seam border"
                        style={{ width: `${(next / max) * 100}%` }}
                        data-ghost={id}
                      />
                    ) : null}
                  </span>
                  <span
                    className="flex w-40 shrink-0 gap-2 t-small whitespace-nowrap"
                    aria-label="status"
                  >
                    {statuses.map((status) => (
                      <span
                        key={status}
                        data-tone="caution"
                        data-status={status}
                        title={STATUS[status][1]}
                      >
                        {STATUS[status][0]}
                      </span>
                    ))}
                  </span>
                </span>
              }
              meta={
                <span className="flex gap-2">
                  <span
                    className="w-36 text-right"
                    data-total={id}
                    data-tone={moved ? "caution" : undefined}
                  >
                    {moved ? <ValueDiff from={fmt(path.total)} to={fmt(next)} /> : fmt(path.total)}
                  </span>
                  <span className="w-14">{critical === id ? "critical" : ""}</span>
                </span>
              }
            />
            {opened ? (
              <Drawer snapshot={snapshot} priced={priced} terminal={id} work={work} />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

const SLOT_WORDS = {
  fanStatic: "fan static (on the unit, in-wg)",
  fanFlow: "fan flow (on the unit, CFM)",
  componentDrop: "component drop (on accessories, in-wg)",
  terminalDrop:
    "terminal drop (on grilles, in-wg; Revit refuses the connector, so a family parameter carries it)",
} as const;

/** The Revit parameter each value travels in; staged names ride the next snapshot read and apply. */
function Slots({ snapshot, work }: { snapshot: DuctSnapshot; work: LossesWork }) {
  const wire: CellWire = { segment: "parameters", revision: work.revision, write: work.write };
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 t-small" data-slots="">
      <span className="t-upper text-ink-2">parameters</span>
      {(Object.keys(SLOT_WORDS) as (keyof typeof SLOT_WORDS)[]).map((slot) => {
        const cell = work.doc?.parameters[slot] ?? {};
        const held = snapshot.slots[slot] ?? "";
        const authored = (cell.staged ?? cell.proposal)?.value;
        return (
          <span
            key={slot}
            className="inline-flex items-baseline gap-1"
            data-slot={slot}
            title={SLOT_WORDS[slot]}
          >
            <span className="text-ink-2">{slot}</span>
            <StateCell
              {...cellFromTrichotomy(cell, {
                value: authored ?? held,
                cap: "editable",
                note: authored && held ? `the snapshot read ${held}` : undefined,
              })}
              scale="row"
              placeholder={slot === "terminalDrop" ? "name a parameter" : "—"}
              onCommit={(text: string) =>
                work
                  .write(
                    transitionPatches(["parameters"], slot, cell, {
                      kind: "stage",
                      rung: { value: text.trim() },
                    }),
                  )
                  .then((refused) => refused?.message)
              }
              transitions={reviewTransitions(wire, slot, cell)}
            />
          </span>
        );
      })}
    </div>
  );
}

export function DuctsLosses({
  snapshot,
  grids,
  priced,
  ready,
  page,
  setPage,
  empty,
  work,
}: {
  snapshot: DuctSnapshot | null;
  grids: Grids | null;
  priced: Priced | null;
  ready: Record<string, GroupReadiness>;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
  work: LossesWork;
}) {
  if (empty || !snapshot)
    return (
      <EmptyState story="scope" exit={empty?.exit ?? "wait for the snapshot"}>
        {empty?.says ?? "reading ducts…"}
      </EmptyState>
    );
  if (!grids || !priced)
    return (
      <EmptyState
        story="scope"
        exit="bind a Revit session; the tables are read from its ASHRAE folder"
      >
        reading the ASHRAE tables…
      </EmptyState>
    );
  const groups = snapshot.groups.filter(
    (group) =>
      (!page.group || group.id === page.group) &&
      Object.values(priced.now.paths).some((path) => path.groupId === group.id),
  );
  if (!groups.length)
    return (
      <EmptyState story="filter" exit="choose another group in the sentence">
        no terminal path to price in {page.group || "this document"}
      </EmptyState>
    );
  const max = Math.max(
    1e-6,
    ...groups.flatMap((g) => [
      priced.now.byGroup[g.id]?.fan ?? 0,
      priced.next.byGroup[g.id]?.fan ?? 0,
    ]),
  );
  return (
    <div className="flex flex-col gap-3 overflow-auto px-(--item-pad-x) py-2">
      <Slots snapshot={snapshot} work={work} />
      <div className="flex flex-wrap items-baseline gap-3 t-small text-ink-2">
        {PARTS.map((part) => (
          <PartChip key={part} part={part} />
        ))}
        {priced.next.errors.length ? (
          <span
            data-tone="caution"
            title="a rule matched but its table gave no coefficient; the bars count it as 0"
          >
            {priced.next.errors.length} unpriced, counted 0
          </span>
        ) : null}
      </div>
      {groups.map((group) => (
        <section key={group.id}>
          <GroupHead snapshot={snapshot} group={group} priced={priced} />
          <Bars
            snapshot={snapshot}
            group={group}
            ready={ready[group.id]}
            priced={priced}
            max={max}
            page={page}
            setPage={setPage}
            work={work}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * The staged band's body (variant J): each staged rule with what it moves before it lands, the
 * staged drops and slots, the last preview's outcome, and discard.
 */
export function StagedLosses({
  snapshot,
  grids,
  priced,
  evaluation,
  fresh,
  work,
  group,
}: {
  snapshot: DuctSnapshot;
  grids: Grids;
  priced: Priced;
  evaluation: DuctsEvaluation | null;
  fresh: boolean;
  work: LossesWork;
  group: string;
}) {
  const keys = Object.keys(priced.staged.rules).sort();
  const terminals = Object.keys(priced.staged.terminalDrops).length;
  const components = Object.keys(priced.staged.componentDrops).length;
  const slots = Object.entries(priced.staged.parameters);
  if (!keys.length && !terminals && !components && !slots.length) return null;
  const fanOf = (result: LossResult) => (group ? result.byGroup[group]?.fan : result.fan);
  const discard = () => {
    const doc = work.doc;
    if (!doc) return;
    void work.write(
      (["rules", "terminalDrops", "componentDrops", "parameters"] as const).flatMap((segment) =>
        Object.entries(doc[segment] ?? {}).flatMap(([key, cell]) =>
          cell?.staged ? transitionPatches([segment], key, cell, { kind: "unstage" }) : [],
        ),
      ),
    );
  };
  return (
    <div className="flex flex-col gap-0.5 t-small" data-staged-band="">
      {keys.map((key) => {
        const rule = ruleByKey(key) ?? LOSS_RULES[0]!;
        const f = stagedFanout(snapshot, grids, priced, key);
        const missing = unpriced(priced, key);
        return (
          <div key={key} className="flex flex-wrap items-baseline gap-x-3" data-staged-rule={key}>
            <span>
              {rule.family} : {rule.type}
              {rule.cond ? <span className="text-ink-2"> · {rule.cond}</span> : null}
            </span>
            <ValueDiff
              from={(priced.applied[key] ?? rule.table).toUpperCase()}
              to={priced.staged.rules[key]!.table.toUpperCase()}
            />
            {f ? (
              <span className="face-mono" data-fanout={key}>
                {f.instances} fittings · {f.movedTerminals.length} grilles · fan{" "}
                <ValueDiff from={fmt(fanOf(f.before))} to={fmt(fanOf(f.after))} />
              </span>
            ) : (
              <span data-tone="caution">not a table this rule takes</span>
            )}
            {missing ? <span data-tone="caution">{missing} unpriced, left out</span> : null}
          </div>
        );
      })}
      {terminals || components ? (
        <div>
          {terminals ? `${terminals} terminal drop${terminals === 1 ? "" : "s"}` : ""}
          {terminals && components ? " · " : ""}
          {components ? `${components} component drop${components === 1 ? "" : "s"}` : ""} · fan{" "}
          <ValueDiff from={fmt(fanOf(priced.now))} to={fmt(fanOf(priced.next))} /> in-wg
        </div>
      ) : null}
      {(evaluation?.response.writes ?? [])
        .filter(
          (w) =>
            w.kind === "equipment" &&
            w.outcome === "planned" &&
            w.id != null &&
            w.after?.startsWith("type "),
        )
        .map((w) => {
          const unit = snapshot.nodes.find((n) => n.id === w.id);
          const shared = snapshot.nodes.filter(
            (n) => n.kind === "equipment" && n.family === unit?.family && n.type === unit?.type,
          ).length;
          return (
            <div key={w.id} data-tone="caution" data-type-fanout={w.id}>
              unit {w.id}: no instance fan static; writes type {unit?.family ?? "?"} :{" "}
              {unit?.type ?? "?"} ({shared} unit{shared === 1 ? "" : "s"})
            </div>
          );
        })}
      {slots.length ? (
        <div className="face-mono">
          {slots.map(([slot, name]) => `${slot} = ${name}`).join(" · ")}
        </div>
      ) : null}
      {/* Every refusal, each on its line: a count with a hidden tail is a refusal the page hides. */}
      {(evaluation?.response.writes ?? [])
        .filter((w) => w.outcome === "refused")
        .map((w, n) => (
          <div
            key={`${w.kind}:${w.id ?? n}`}
            data-tone="caution"
            data-refused={`${w.kind}:${w.id ?? ""}`}
          >
            {w.kind} {w.id ?? ""} refused: {w.reason ?? "no reason"}
          </div>
        ))}
      <div className="flex flex-wrap items-baseline gap-x-3">
        {evaluation ? (
          <span
            data-tone={fresh ? undefined : "caution"}
            data-evaluation={fresh ? "fresh" : "stale"}
          >
            preview r{evaluation.revision}:{" "}
            {Object.entries(evaluation.response.counts)
              .filter(([, n]) => n)
              .map(([outcome, n]) => `${n} ${outcome}`)
              .join(" · ") || "nothing to write"}
            {fresh ? "" : " · stale, preview again"}
          </span>
        ) : (
          <span className="text-ink-2">not previewed</span>
        )}
        <Press
          size="caption"
          tone="quiet"
          onClick={discard}
          title="Unstage every staged rule, drop and slot"
        >
          discard
        </Press>
      </div>
    </div>
  );
}
