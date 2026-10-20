/**
 * proto: copied from losses-view.tsx (round 2, E1/E2 edit popover). The losses item's per-grille
 * drawer (rules on the path with their table chips, the terminal and component drops, the catalog
 * link) is unexported there, so the minimum is copied here unchanged; `StagedRules` is a reduced
 * copy of `StagedLosses` that needs no ASHRAE grids (the variants are not handed them).
 */
import { memo, useMemo, useState } from "react";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { transitionPatches, type DuctDrop, type DuctsRouteDocument, type RouteStatePatch } from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "#/components/lang/switcher";
import { ValueDiff } from "#/components/lang/value-diff";
import type { Column } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { LOSS_RULES, ruleByKey } from "@pe/ducts-domain/loss-rules";
import type { Row } from "@pe/ducts-domain/losses";
import { instancesOf, partOf, tableOf, unpriced, type Part, type Priced } from "@pe/ducts-domain/pricing";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { LossesWork } from "../../losses-view";
type Node = DuctSnapshot["nodes"][number];
// proto: copied from losses-view.tsx
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
export const Drawer = memo(function Drawer({
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
export const PartChip = ({ part }: { part: Part }) => (
  <span className="inline-flex items-center gap-1 t-small face-mono">
    <span className={`inline-block size-2 ${PART_BG[part]}`} />
    {part}
  </span>
);
/**
 * proto: copied from losses-view.tsx (`StagedLosses`, reduced): each staged rule as applied → staged,
 * the staged drops and unit statics with the fan they move, and discard. The fan-out per rule needs
 * the ASHRAE grids, which the variants are not handed, so it is left out.
 */
export function StagedRules({
  priced,
  group,
  work,
}: {
  priced: Priced;
  group: string;
  work: LossesWork;
}) {
  const keys = Object.keys(priced.staged.rules).sort();
  const terminals = Object.keys(priced.staged.terminalDrops).length;
  const components = Object.keys(priced.staged.componentDrops).length;
  const units = Object.keys(priced.staged.unitStatics).length;
  const catalogs = Object.keys(priced.staged.catalogs).length;
  const fanOf = (r: Priced["now"]) => (group ? r.byGroup[group]?.fan : r.fan);
  const discard = () => {
    const doc = work.doc;
    if (!doc) return;
    void work.write(
      (["rules", "catalogs", "terminalDrops", "componentDrops", "unitStatics"] as const).flatMap(
        (segment) =>
          Object.entries(doc[segment] ?? {}).flatMap(([key, cell]) =>
            cell?.staged ? transitionPatches([segment], key, cell, { kind: "unstage" }) : [],
          ),
      ),
    );
  };
  if (!keys.length && !terminals && !components && !units && !catalogs)
    return <p className="text-ink-2 t-small">nothing staged: no rule, drop, catalog or unit static</p>;
  return (
    <div className="flex flex-col gap-0.5 t-small" data-e-staged="">
      {keys.map((key) => {
        const rule = ruleByKey(key) ?? LOSS_RULES[0]!;
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
          </div>
        );
      })}
      {terminals || components || units || catalogs ? (
        <div>
          {[
            terminals ? `${terminals} terminal drop${terminals === 1 ? "" : "s"}` : "",
            components ? `${components} component drop${components === 1 ? "" : "s"}` : "",
            catalogs ? `${catalogs} catalog link${catalogs === 1 ? "" : "s"}` : "",
            units ? `${units} unit static${units === 1 ? "" : "s"}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
      <div className="flex items-baseline gap-2">
        <span>
          fan <ValueDiff from={fmt(fanOf(priced.now))} to={fmt(fanOf(priced.next))} /> in-wg
        </span>
        <Button label="Discard every staged rule, drop, catalog link and unit static" onClick={discard}>
          discard
        </Button>
      </div>
    </div>
  );
}
