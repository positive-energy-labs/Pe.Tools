import { elementKey, useMention } from "@pe/kit/lang/attention";
import { useNativeObservation } from "#/revit/observation";
import { RevitTarget, revitTarget } from "@pe/kit/lang/revit-target";
import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
/**
 * The per-run panel, the way RHVAC lays one duct out: its straight length, the design loss per
 * 100 ft against its own actual rate, its roughness, the additional SP loss stated on it, and the
 * fittings it feeds each as equivalent feet and an SP loss. A "run" here is one duct and the parts
 * its air passes before the next duct, read off the priced path that carries the selected element.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { Row } from "@pe/ducts-domain/losses";

import { fmt, fmtFt } from "./bar";

interface RunPart {
  id: number;
  kind: Row["kind"];
  eqFt: number | null;
  dp: number | null;
  /** Priced by a stated drop (a person's or the model's), not a table lookup. */
  stated: boolean;
  desc: string;
}

export interface RunData {
  ductId: number;
  /** The path (terminal id) the numbers are read on. */
  terminal: number;
  lengthFt: number;
  /** The duct's own actual friction rate, in-wg per 100 ft. */
  rate: number | null;
  frictionDp: number;
  roughnessFt: number | null;
  roughness: string | null;
  size: string | null;
  /** Stated drops on the parts it feeds, in-wg: RHVAC's additional SP loss. */
  additionalDp: number;
  parts: RunPart[];
}

/**
 * The run the selected element belongs to: the path of the system's groups that carries it (a
 * critical one first), the duct at or before it on that path, and the parts after that duct up to
 * the next duct.
 */
export function runOf(priced: Priced, groups: readonly string[], selected: number): RunData | null {
  const critical = new Set(groups.map((g) => priced.next.byGroup[g]?.critical));
  const terminals = Object.keys(priced.next.paths)
    .map(Number)
    .filter((t) => groups.includes(priced.next.paths[t]!.groupId))
    .sort((a, b) => Number(critical.has(b)) - Number(critical.has(a)) || a - b);
  for (const terminal of terminals) {
    const rows = priced.next.paths[terminal]!.rows;
    const at = rows.findIndex((r) => r.id === selected);
    if (at < 0) continue;
    let anchor = at;
    while (anchor >= 0 && rows[anchor]!.kind !== "friction") anchor--;
    if (anchor < 0) continue;
    const ductId = rows[anchor]!.id;
    const own = rows.filter((r) => r.kind === "friction" && r.id === ductId);
    const first = rows.indexOf(own[0]!);
    const parts: RunPart[] = [];
    for (const row of rows.slice(first + 1)) {
      if (row.kind === "friction") {
        if (row.id === ductId) continue;
        break;
      }
      parts.push({
        id: row.id,
        kind: row.kind,
        eqFt: row.eqFt ?? null,
        dp: row.dp,
        stated: row.kind !== "terminal" && row.rule == null && row.error == null,
        desc: row.desc,
      });
    }
    const lengthFt = own.reduce((a, r) => a + (r.lengthFt ?? 0), 0);
    const frictionDp = own.reduce((a, r) => a + (r.dp ?? 0), 0);
    const segment = priced.snapshot.segments.find((s) => s.id === ductId);
    return {
      ductId,
      terminal,
      lengthFt,
      rate: lengthFt > 1e-9 && frictionDp > 0 ? (frictionDp / lengthFt) * 100 : null,
      frictionDp,
      roughnessFt: own[0]!.roughnessFt ?? null,
      roughness: segment?.roughness.provenance ?? null,
      size: segment?.size ?? null,
      additionalDp: parts.filter((p) => p.stated).reduce((a, p) => a + (p.dp ?? 0), 0),
      parts,
    };
  }
  return null;
}

export function RunDetail({
  run,
  designRate,
  nameOf,
}: {
  run: RunData;
  designRate: number;
  nameOf: (id: number) => string;
}) {
  const observation = useNativeObservation();
  const mark = useMention();
  const list = useList({
    items: run.parts,
    keyOf: (part) => `${part.id}:${run.parts.indexOf(part)}`,
    search: (part) => ({ text: [nameOf(part.id), part.desc], ids: [part.id] }),
  });
  const over = run.rate != null && run.rate > designRate;
  return (
    <section
      className="border-line t-small max-h-[45%] shrink-0 overflow-y-auto border-t px-2 py-1.5"
      {...revitTarget([run.ductId])}
      data-e-run-detail={run.ductId}
      aria-label="run detail"
      {...mark(elementKey(run.ductId))}
    >
      <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3">
        <dt className="text-ink-2">length</dt>
        <dd className="face-mono">{run.lengthFt.toFixed(1)} ft</dd>
        <dd />
        <dt className="text-ink-2">design loss/100</dt>
        <dd className="face-mono">{fmt(designRate, 3)} in-wg</dd>
        <dd className="text-ink-mute">settings</dd>
        <dt className="text-ink-2">actual loss/100</dt>
        <dd className="face-mono" data-e-rate={run.rate ?? ""}>
          {run.rate == null ? "—" : `${run.rate.toFixed(3)} in-wg`}
        </dd>
        <dd className="text-ink-mute">{over ? "over the design rate" : ""}</dd>
        <dt className="text-ink-2">roughness</dt>
        <dd className="face-mono">
          {run.roughnessFt == null ? "—" : `${run.roughnessFt.toFixed(4)} ft`}
        </dd>
        <dd className="text-ink-mute">{run.roughness ?? ""}</dd>
        <dt className="text-ink-2">friction loss</dt>
        <dd className="face-mono">{fmt(run.frictionDp, 4)} in-wg</dd>
        <dd />
        <dt className="text-ink-2">additional SP loss</dt>
        <dd className="face-mono" data-e-additional={run.additionalDp}>
          {fmt(run.additionalDp, 4)} in-wg
        </dd>
        <dd className="text-ink-mute">stated drops</dd>
      </dl>
      <RevitTarget scope={observation.scope}>
        <div data-e-parts="">
          <PlainList
            list={list}
            aria-label="run fittings"
            columns={{ label: "fittings", meta: "eq ft · SP loss" }}
            empty={{ message: "no fittings", exit: "Select another run" }}
            row={(part) => ({
              label: nameOf(part.id),
              aside: part.stated ? "stated" : undefined,
              title: part.desc,
              meta: `${fmtFt(part.eqFt)} · ${fmt(part.dp, 4)}`,
            })}
          />
        </div>
      </RevitTarget>
    </section>
  );
}
