/**
 * proto: copied from losses-view.tsx (round 3, E2 Rules section). The losses item's table chips per
 * rule and its stated-drop cell are unexported there, so the minimum is copied here unchanged;
 * `StagedRules` is a reduced copy of `StagedLosses` that needs no ASHRAE grids.
 */
import { transitionPatches, type DuctDrop, type DuctsRouteDocument, type RouteStatePatch } from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "#/components/lang/switcher";
import { ValueDiff } from "#/components/lang/value-diff";
import { LOSS_RULES, ruleByKey } from "@pe/ducts-domain/loss-rules";
import { tableOf, type Priced } from "@pe/ducts-domain/pricing";
import type { LossesWork } from "../../losses-view";
// proto: copied from losses-view.tsx
const fmt = (n: number | null | undefined) => (n == null ? "" : n.toFixed(4));
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
export function DropCell({
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
export function Chips({ ruleKey, priced, work }: { ruleKey: string; priced: Priced; work: LossesWork }) {
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
  const units = Object.keys(priced.staged.esp).length;
  const catalogs = Object.keys(priced.staged.catalogs).length;
  const fanOf = (r: Priced["now"]) => (group ? r.byGroup[group]?.fan : r.fan);
  const discard = () => {
    const doc = work.doc;
    if (!doc) return;
    void work.write(
      (["rules", "catalogs", "terminalDrops", "componentDrops", "esp"] as const).flatMap(
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
