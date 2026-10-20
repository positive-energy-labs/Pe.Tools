import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * The losses view (`page.view = "losses"`): the grille is the unit (pressure-drop ledger, F). Per
 * group, one bar per terminal segmented by what eats the pressure; the longest is the fan. Pe's
 * fan sits beside Revit's critical path in the group head. Opening a terminal draws its drawer:
 * the rules on its path with their table chips, its terminal drop and the components on it.
 * A chip or a number STAGES a Work cell; nothing reaches Revit until preview and apply. The bars
 * show what Revit holds now and ghost to the staged state, as the staged band does (variant J).
 */
import { Fragment, memo, useMemo, useState, type ComponentProps } from "react";
import type { DuctsApply } from "@pe/host-contracts/generated";
import {
  transitionPatches,
  type DuctDrop,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { Row as ListRow } from "@pe/kit/lang/row";
import { Switcher } from "#/components/lang/switcher";
import { ValueDiff } from "#/components/lang/value-diff";
import type { Column } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import type { DuctsEvaluation, DuctsPage } from "./manifest";
import { assessDucts } from "@pe/ducts-domain/assessment";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { parseLoadPreview } from "@pe/ducts-domain/load-preview";
import { LOSS_RULES, ruleByKey } from "@pe/ducts-domain/loss-rules";
import type { LossResult, Row } from "@pe/ducts-domain/losses";
import { systemFor } from "@pe/ducts-domain/losses";
import {
  applyRequest,
  instancesOf,
  partOf,
  PARTS,
  stagedFanout,
  tableOf,
  unitOf,
  unpriced,
  type Part,
  type Priced,
} from "@pe/ducts-domain/pricing";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { snapshotById, type GroupReadiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { FindingsList } from "./issues";
type Node = DuctSnapshot["nodes"][number];
type Group = DuctSnapshot["groups"][number];
type Assessment = ReturnType<typeof assessDucts>;
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
 * reasons (no mover) are said once in the group head, never per row. */
const STATUS = {
  "open-end": ["open end", "an open end on this path is not answered (capped or ignored)"],
  refuses: ["drop refused", "the connector is not Specific Loss; Revit refuses a terminal drop"],
  "no-drop": ["no drop", "no terminal drop is known; stage one from the catalog"],
  inferred: [
    "inferred",
    "the total rests on joints or taps inferred by proximity; a person rules on each in the findings",
  ],
} as const;
type Status = keyof typeof STATUS;
function terminalStatus(
  snapshot: DuctSnapshot,
  ready: GroupReadiness | undefined,
  node: Node,
  priced: Priced,
  dropKnown: boolean,
): Status[] {
  const { issues } = snapshotById(snapshot);
  const out: Status[] = [];
  if (ready?.walk.some((id) => issues.get(id)?.kind === "open-end")) out.push("open-end");
  if (node.terminalDrop && !node.terminalDrop.writable) out.push("refuses");
  const terminal = priced.next.paths[node.id]?.rows.find((row) => row.kind === "terminal");
  if (terminal?.error || !dropKnown) out.push("no-drop");
  if (priced.next.paths[node.id]?.inferred.length) out.push("inferred");
  return out;
}
/** Stage a rule's table; staging the table already staged takes it back. */
const tablePatches = (
  doc: DuctsRouteDocument | null,
  key: string,
  table: string,
): RouteStatePatch[] => {
  const cell = doc?.rules[key] ?? {};
  return cell.staged?.value.table === table
    ? transitionPatches(["rules"], key, cell, { kind: "unstage" })
    : transitionPatches(["rules"], key, cell, { kind: "stage", rung: { value: { table } } });
};
const kindWord = (kind: string) => kind.replace(/ air$/i, "").toLowerCase();
/** Stage Pe's fan static for a unit; staging the number already staged takes it back. */
const fanPatches = (
  doc: DuctsRouteDocument | null,
  unit: number,
  inWg: number,
): RouteStatePatch[] => {
  const key = String(unit);
  const cell = doc?.unitStatics[key] ?? {};
  return cell.staged?.value.inWg === inWg
    ? transitionPatches(["unitStatics"], key, cell, { kind: "unstage" })
    : transitionPatches(["unitStatics"], key, cell, { kind: "stage", rung: { value: { inWg } } });
};
/** Refusals folded per reason: the shared-type refusal names the same peers for every unit of a type. */
export function foldRefusals(writes: readonly DuctsApply.Res.DuctWrite[]) {
  const by = new Map<
    string,
    {
      reason: string;
      kinds: Set<string>;
      ids: number[];
    }
  >();
  for (const w of writes) {
    if (w.outcome !== "refused") continue;
    const reason = w.reason ?? "no reason";
    const fold =
      by.get(reason) ?? by.set(reason, { reason, kinds: new Set(), ids: [] }).get(reason)!;
    fold.kinds.add(w.kind);
    if (w.id != null) fold.ids.push(w.id);
  }
  return [...by.values()].map(({ reason, kinds, ids }) => ({
    reason,
    kind: [...kinds].join("/"),
    ids,
  }));
}
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
function CatalogLink({ node, priced, work }: { node: Node; priced: Priced; work: LossesWork }) {
  const key = catalogLinkKey(node.family, node.type);
  const cell = work.doc?.catalogs[key] ?? {};
  const held = node.facts.find((f) => f.key === "Pe_Catalog")?.text ?? "";
  const wire: CellWire = { segment: "catalogs", revision: work.revision, write: work.write };
  return (
    <span aria-label={`catalog for ${node.family} : ${node.type}`}>
      <StateCell
        {...cellFromTrichotomy(cell, {
          value: (cell.staged ?? cell.proposal)?.value?.table ?? held,
          cap: "editable",
          note: priced.staged.catalogs[key]
            ? "Staged for every instance of this family/type"
            : "Pe_Catalog type parameter",
        })}
        scale="row"
        placeholder="link catalog table id"
        onCommit={(table: string) => {
          if (!Object.hasOwn(priced.catalogs, table)) return "Choose a loaded catalog table id";
          return work
            .write(
              transitionPatches(["catalogs"], key, cell, {
                kind: "stage",
                rung: { value: { table } },
              }),
            )
            .then((refusal) => refusal?.message);
        }}
        transitions={reviewTransitions(wire, key, cell)}
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
  | {
      kind: "rule";
      key: string;
      rows: Row[];
    }
  | {
      kind: "instances";
      key: string;
    }
  | {
      kind: "friction";
      rows: Row[];
    }
  | {
      kind: "component";
      row: Row;
    }
  | {
      kind: "terminal";
      rows: Row[];
    };
const rowId = (row: DrawerRow) =>
  row.kind === "rule" || row.kind === "instances"
    ? `${row.kind}:${row.key}`
    : row.kind === "component"
      ? `component:${row.row.id}`
      : row.kind;
const Drawer = memo(function Drawer({
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
  const { nodes, segments } = snapshotById(snapshot);
  const path = priced.next.paths[terminal];
  const node = nodes.get(terminal);
  const columns = useMemo<Column<DrawerRow>[]>(() => {
    const total = path?.total ?? 0;
    const sum = (list: Row[]) => list.reduce((a, row) => a + (row.dp ?? 0), 0);
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
              <TooltipHint
                content={`${rule.family} : ${rule.type}${rule.cond ? ` · ${rule.cond}` : ""}`}
              >
                <span className="block truncate px-(--item-pad-x)" data-rule={row.key}>
                  {rule.family} : {rule.type}
                  {rule.cond ? <span className="text-ink-2"> · {rule.cond}</span> : null}
                  {missing ? (
                    <span data-tone="caution">
                      {" "}
                      · {missing} with no value under {tableOf(priced, row.key)}
                    </span>
                  ) : null}
                </span>
              </TooltipHint>
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
              {row.rows[0]?.error ? <span data-tone="caution"> · {row.rows[0].error}</span> : null}
              {row.rows[0]?.notes?.map((note) => (
                <span className="block text-ink-2" key={note}>
                  {note}
                </span>
              ))}
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
            <span className="block px-(--item-pad-x)">
              <DropCell
                segment="terminalDrops"
                id={terminal}
                held={
                  node?.terminalDrop?.catalogDropInWg ??
                  node?.terminalDrop?.assignedPressureDropInWg
                }
                work={work}
                label={`terminal ${terminal} drop`}
              />
              <CatalogLink node={node!} priced={priced} work={work} />
              {row.rows[0]?.source ? (
                <a
                  className="block"
                  href={`${row.rows[0].source.url}#page=${row.rows[0].source.pdfPage}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.rows[0].table} · {row.rows[0].source.file} p. {row.rows[0].source.page}
                </a>
              ) : (
                row.rows[0]?.table
              )}
            </span>
          ) : null,
      },
      {
        key: "n",
        label: "n",
        width: "w-10",
        title: "distinct fittings the rule prices; press to list them",
        cell: (row) =>
          row.kind !== "rule" ? null : (
            <Button
              label="show the instances under this rule"
              onClick={() =>
                setOpen((was) => {
                  const next = new Set(was);
                  if (!next.delete(row.key)) next.add(row.key);
                  return next;
                })
              }
            >
              {instancesOf(priced.next, row.key).size}
            </Button>
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
        cell: (row) => (
          <span className={mono}>
            {own(row).some((r) => r.dp == null) ? "—" : fmt(sum(own(row))) || ""}
          </span>
        ),
      },
      {
        key: "share",
        label: "share",
        title: "of this grille's total",
        width: "w-12",
        cell: (row) => (
          <span className={mono}>
            {own(row).some((r) => r.dp == null) ? "" : pct(sum(own(row)), total)}
          </span>
        ),
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
});
const PartChip = ({ part }: { part: Part }) => (
  <span className="inline-flex items-center gap-1 t-small face-mono">
    <span className={`inline-block size-2 ${PART_BG[part]}`} />
    {part}
  </span>
);
/** Revit's critical path as a word, whatever the engine flag: a system with no path reads "no path". */
export const revitSays = (inWg: number | null | undefined) =>
  inWg == null ? "no path" : fmt(inWg);
/** Pe's fan beside Revit's critical path, with the staged fan when it differs. */
function GroupHead({
  snapshot,
  group,
  priced,
  assessment,
  work,
}: {
  snapshot: DuctSnapshot;
  group: Group;
  priced: Priced;
  assessment: Assessment;
  work: LossesWork;
}) {
  const now = priced.now.byGroup[group.id];
  const next = priced.next.byGroup[group.id];
  const critical = now?.critical ?? null;
  const revit = critical == null ? null : systemFor(snapshot, critical);
  // The air mover Pe's number would be written to; nothing reaches it until a person stages it.
  const unit = unitOf(snapshot, priced.now, group);
  const demand = assessment.equipment.find((equipment) => equipment.id === unit);
  const sum = demand?.next ?? null;
  const proposed = demand?.requiredEspStagedInWg ?? null;
  const stagedStatic = unit == null ? undefined : priced.staged.unitStatics[String(unit)]?.inWg;
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-1" data-group-head={group.id}>
      <span className="t-title">
        {group.id} · {group.systemNames.slice(0, 3).join(", ") || "no system"}
      </span>
      <span className="inline-flex items-baseline gap-1">
        <span className="t-small t-upper text-ink-2">fan static</span>
        <span className="t-small text-ink-2">Pe</span>
        <b className="face-mono" data-fan={group.id}>
          {fmt(demand?.calculationRole ? null : now?.fan)}
        </b>
        {!demand?.calculationRole && next && now && Math.abs(next.fan - now.fan) > 1e-9 ? (
          <span data-tone="caution" data-fan-next={group.id}>
            <ValueDiff from="" to={fmt(next.fan)} />
          </span>
        ) : null}
        <span className="t-small text-ink-2">in-wg · Revit</span>
        <span className="face-mono" data-revit={group.id}>
          {revitSays(revit?.criticalPathLossInWg)}
        </span>
      </span>
      <span className="t-small text-ink-2">
        critical <span className="face-mono">{critical ?? "—"}</span>
      </span>
      {group.rootIds.length === 0 ? (
        <span className="t-small" data-tone="caution">
          {NO_ROOT}
        </span>
      ) : unit == null ? (
        <span className="t-small text-ink-2">no air mover</span>
      ) : (
        <span className="inline-flex items-baseline gap-1 t-small" data-unit={unit}>
          <span className="text-ink-2">unit</span>
          <span className="face-mono">{unit}</span>
          <span className="text-ink-2">Pe proposes</span>
          <b className="face-mono">{proposed == null ? "—" : proposed.toFixed(4)}</b>
          {sum && sum.parts.length > 1 ? (
            <span className="face-mono text-ink-2" data-unit-parts={unit}>
              ({sum.parts.map(({ kind, fan }) => `${kindWord(kind)} ${fmt(fan)}`).join(" + ")})
            </span>
          ) : null}
          {stagedStatic !== undefined && stagedStatic !== proposed ? (
            <span data-tone="caution" data-unit-staged={unit}>
              staged {stagedStatic}
            </span>
          ) : null}
          {proposed == null ? null : (
            <Button
              data-tone={stagedStatic === proposed ? "caution" : undefined}
              onClick={() => void work.write(fanPatches(work.doc, unit, proposed))}
              label={
                stagedStatic === proposed
                  ? "Take the staged fan static back"
                  : `Stage ${proposed} in-wg as unit ${unit}'s external static; it is not in Revit until written`
              }
            >
              {stagedStatic === proposed ? "staged" : "stage"}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
function Bars({
  snapshot,
  group,
  ready,
  priced,
  assessment,
  max,
  selected,
  setPage,
  work,
}: {
  snapshot: DuctSnapshot;
  group: Group;
  ready: GroupReadiness | undefined;
  priced: Priced;
  assessment: Assessment;
  max: number;
  selected: string;
  setPage: (next: Partial<DuctsPage>) => void;
  work: LossesWork;
}) {
  const { nodes } = snapshotById(snapshot);
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
          by.set(part, (by.get(part) ?? 0) + (row.dp ?? 0));
        }
        const next = priced.next.paths[id]?.total ?? path.total;
        const moved = Math.abs(next - path.total) > 1e-9;
        const statuses = terminalStatus(
          snapshot,
          ready,
          node,
          priced,
          assessment.terminalDrops[node.id] ?? false,
        );
        const opened = selected === String(id);
        const flow = assessment.flows.get(id);
        const inferred = priced.next.paths[id]?.inferred ?? [];
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
                    {Math.round(flow?.cfm ?? 0)} cfm{" "}
                    <span className="text-ink-2" data-flow-source={flow?.source ?? ""}>
                      {flow?.source ?? "no flow"}
                    </span>
                  </span>
                  <span className="relative flex h-4 flex-1 bg-(--pe-recess)">
                    {PARTS.filter((part) => by.get(part)).map((part) => (
                      <TooltipHint
                        key={part}
                        content={`${part}: ${fmt(by.get(part))} (${pct(by.get(part)!, path.total)})`}
                      >
                        <span
                          data-part={part}
                          className={PART_BG[part]}
                          style={{ width: `${(by.get(part)! / max) * 100}%` }}
                        />
                      </TooltipHint>
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
                      <TooltipHint
                        key={status}
                        content={
                          status === "inferred"
                            ? `rests on ${inferred.length} inferred join${inferred.length === 1 ? "" : "s"} (${inferred.join(", ")}); a person rules on each in the findings`
                            : STATUS[status][1]
                        }
                      >
                        <span data-tone="caution" data-status={status}>
                          {status === "inferred"
                            ? `${inferred.length} inferred`
                            : STATUS[status][0]}
                        </span>
                      </TooltipHint>
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
/** One group's head and bars; memoized so only a group whose own inputs moved re-renders. */
const GroupSection = memo(function GroupSection(props: ComponentProps<typeof Bars>) {
  return (
    <section>
      <GroupHead
        snapshot={props.snapshot}
        group={props.group}
        priced={props.priced}
        assessment={props.assessment}
        work={props.work}
      />
      <Bars {...props} />
    </section>
  );
});
const SLOT_WORDS = {
  fanStatic: "fan static (on the unit, in-wg)",
  fanFlow: "fan flow (on the unit, CFM)",
  componentDrop: "component drop (on accessories, in-wg)",
  terminalDrop:
    "terminal drop (on grilles, in-wg; Revit refuses the connector, so a family parameter carries it)",
  fittingCoefficient:
    "fitting coefficient (on fittings, a number the family computes; the Pe loss server reads it live)",
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
          <TooltipHint key={slot} content={SLOT_WORDS[slot]}>
            <span className="inline-flex items-baseline gap-1" data-slot={slot}>
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
          </TooltipHint>
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
  empty: {
    says: string;
    exit: string;
  } | null;
  work: LossesWork;
}) {
  const assessment = useMemo(
    () =>
      snapshot && priced
        ? assessDucts(
            snapshot,
            work.doc,
            { now: priced.now, next: priced.next, readiness: ready },
            { selector: page.group ? { kind: "group", id: page.group } : { kind: "document" } },
          )
        : null,
    [snapshot, priced, ready, work.doc, page.group],
  );
  if (empty || !snapshot)
    return (
      <EmptyState story="scope" exit={empty?.exit ?? "wait for the snapshot"}>
        {empty?.says ?? "reading ducts…"}
      </EmptyState>
    );
  if (!grids || !priced || !assessment)
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
      <div className="flex items-baseline gap-2 t-small">
        <Button
          label="Stage the load tool's Load Preview from the clipboard as this document's loads"
          onClick={() =>
            void navigator.clipboard.readText().then((text) =>
              work.write(
                transitionPatches(["loads"], "preview", work.doc?.loads.preview ?? {}, {
                  kind: "stage",
                  rung: { value: { systems: parseLoadPreview(text).systems } },
                }),
              ),
            )
          }
        >
          paste loads
        </Button>
        <span className="text-ink-2">
          {work.doc?.loads.preview?.staged
            ? `${work.doc.loads.preview.staged.value.systems.length} systems staged`
            : "no load preview"}
        </span>
      </div>
      <FindingsList findings={assessment.findings} />
      <div className="flex flex-wrap items-baseline gap-3 t-small text-ink-2">
        {PARTS.map((part) => (
          <PartChip key={part} part={part} />
        ))}
        {priced.next.errors.length ? (
          <TooltipHint content="Some rows have no pressure value. Bars and path totals show only the priced subtotal.">
            <span data-tone="caution">
              {priced.next.errors.length} unpriced; totals are partial
            </span>
          </TooltipHint>
        ) : null}
      </div>
      {groups.map((group) => (
        <GroupSection
          key={group.id}
          snapshot={snapshot}
          group={group}
          ready={ready[group.id]}
          priced={priced}
          assessment={assessment}
          max={max}
          // Only the group holding the open grille sees `selected`, so a pick re-renders one group.
          selected={
            priced.now.paths[Number(page.selected)]?.groupId === group.id ? page.selected : ""
          }
          setPage={setPage}
          work={work}
        />
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
  const catalogLinks = Object.entries(priced.staged.catalogs);
  const terminals = Object.keys(priced.staged.terminalDrops).length;
  const components = Object.keys(priced.staged.componentDrops).length;
  const units = Object.keys(priced.staged.unitStatics).sort();
  const slots = Object.entries(priced.staged.parameters);
  if (
    !keys.length &&
    !catalogLinks.length &&
    !terminals &&
    !components &&
    !units.length &&
    !slots.length
  )
    return null;
  // What a write sends: the group in the sentence, or the whole document; the rules' tables are
  // document-wide either way.
  const all = applyRequest(snapshot, priced, "", "");
  const sent = group ? applyRequest(snapshot, priced, "", group) : all;
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const groupsHit = new Set(all.fittings.map((f) => nodes.get(f.id)?.groupId)).size;
  const count = (request: typeof all, key: string) =>
    request.fittings.filter((f) => f.ruleKey === key).length;
  const fanOf = (result: LossResult) => (group ? result.byGroup[group]?.fan : result.fan);
  const discard = () => {
    const doc = work.doc;
    if (!doc) return;
    void work.write(
      (
        [
          "rules",
          "catalogs",
          "terminalDrops",
          "componentDrops",
          "unitStatics",
          "parameters",
        ] as const
      ).flatMap((segment) =>
        Object.entries(doc[segment] ?? {}).flatMap(([key, cell]) =>
          cell?.staged ? transitionPatches([segment], key, cell, { kind: "unstage" }) : [],
        ),
      ),
    );
  };
  return (
    <div className="flex flex-col gap-0.5 t-small" data-staged-band="">
      {!group && all.fittings.length ? (
        <div className="text-ink-2" data-scope="every">
          every group: {all.fittings.length} fittings in {groupsHit} group
          {groupsHit === 1 ? "" : "s"}
        </div>
      ) : null}
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
            {group ? (
              <span className="text-ink-2" data-writes={key}>
                writes {count(sent, key)} of {count(all, key)} instances (this group); choose every
                group to write all
              </span>
            ) : null}
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
      {catalogLinks.map(([key, { table }]) => {
        const matches = snapshot.nodes.filter(
          (node) =>
            node.kind === "terminal" &&
            [catalogLinkKey(node.family, node.type), catalogLinkKey(node.family, "")].includes(key),
        );
        const ids = new Set(matches.map((node) => node.id));
        const count = sent.terminals.filter((row) => ids.has(row.id)).length;
        return (
          <div key={key} data-staged-catalog={key}>
            {matches[0]?.family} : {matches[0]?.type} · {table} · {matches.length} grilles share
            this catalog link · {count} total-pressure drops in this apply
          </div>
        );
      })}
      {units.map((id) => {
        const unit = snapshot.nodes.find((n) => n.id === Number(id));
        const planned = (evaluation?.response.writes ?? []).find(
          (w) =>
            w.kind === "equipment" &&
            w.outcome === "planned" &&
            w.id === Number(id) &&
            w.after?.startsWith("type "),
        );
        const shared = snapshot.nodes.filter(
          (n) => n.kind === "equipment" && n.family === unit?.family && n.type === unit?.type,
        ).length;
        const inScope = !group || sent.equipment.some((e) => e.id === Number(id));
        return (
          <Fragment key={id}>
            <div data-staged-unit={id}>
              unit {id}: fan static {priced.staged.unitStatics[id]!.inWg} in-wg
              {inScope ? "" : " · not this group's unit, left out"}
            </div>
            {planned && inScope ? (
              <div data-tone="caution" data-type-fanout={id}>
                unit {id}: no instance fan static; writes the type {unit?.family ?? "?"} :{" "}
                {unit?.type ?? "?"}: moves {shared} unit{shared === 1 ? "" : "s"}
              </div>
            ) : null}
          </Fragment>
        );
      })}
      {slots.length ? (
        <div className="face-mono">
          {slots.map(([slot, name]) => `${slot} = ${name}`).join(" · ")}
        </div>
      ) : null}
      {/* One line per distinct reason, naming every id it covers; never a count with a hidden tail. */}
      {foldRefusals(
        (evaluation?.response.writes ?? []).filter(
          (w) => w.kind !== "equipment" || String(w.id) in priced.staged.unitStatics,
        ),
      ).map(({ reason, kind, ids }) => (
        <div key={`${kind}:${reason}`} data-tone="caution" data-refused={`${kind}:${ids[0] ?? ""}`}>
          {ids.length === 1
            ? `${kind} ${ids[0]} refused: ${reason}`
            : `${kind} refused: ${reason}${ids.length ? ` · ids ${ids.join(", ")}` : ""}`}
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
        <Button onClick={discard} label="Unstage every staged rule, drop, fan static and slot">
          discard
        </Button>
      </div>
    </div>
  );
}
