/**
 * The worksheet (ducts LEDGER 2026-10-29, "TS"): per side, one row per run from the fan to an end,
 * critical first; a row opens into its sections, the stretches of constant flow between
 * junctions. Rows are Subjects (`run:<id>`, `section:<id>`), so hovering one lights it in the
 * picture once the sheet registers their members. Velocity over the limit is the one alarm ink;
 * the page paints nothing else. A 3D pick that selects a `section:` opens it under the critical
 * run that holds it and marks the other runs through it (ruling C).
 */
import { useContext, useState } from "react";
import { AttentionDocument, mention, useAttention, type SubjectKey } from "@pe/kit/lang/attention";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { pressure, type Detail } from "./api";

type Ws = Detail<"worksheet">;
type Side = "supply" | "return";
type Run = Ws["supply"]["runs"][number];
type Section = Ws["supply"]["sections"][number];

const ft = (v: number) => v.toFixed(0);
const fpm = (v: number | null) => (v == null ? "—" : v.toFixed(0));
const ROW =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_4rem_4rem_5.5rem_5.5rem_4.5rem] items-baseline gap-x-3 py-0.5";

function EndName({ run }: { run: Run }) {
  const end = run.end;
  if (end.kind === "terminal")
    return (
      <SubjectText
        text={[{ id: end.elementId, connector: end.connector }]}
        revit={[end.elementId]}
        owner={run.id}
      />
    );
  return (
    <span className="text-ink-2">
      {end.kind}
      {end.fan && (
        <>
          {" "}
          <SubjectText
            text={[{ id: end.fan.unitId }]}
            revit={[end.fan.unitId]}
            owner={`${run.id}:fan`}
          />
        </>
      )}
    </span>
  );
}

function SectionRows({ ws, run, side, doc }: { ws: Ws; run: Run; side: Side; doc: string }) {
  const byId = new Map(ws[side].sections.map((s) => [s.id, s]));
  let cumulative = 0;
  return (
    <>
      {run.sectionIds.map((id) => {
        const s = byId.get(id) as Section;
        cumulative += s.knownInWg;
        const first = ws.legs[s.legIds[0]!]!;
        return (
          <div
            key={id}
            role="row"
            className={`${ROW} pl-6 t-small`}
            data-section={id}
            {...mention({ doc, key: `section:${id}` as SubjectKey })}
          >
            <span
              className="face-mono text-ink-2"
              title={`${s.runIds.length} runs share this section`}
            >
              {s.runIds.length > 1 ? `×${s.runIds.length}` : ""}
            </span>
            <span className="min-w-0 truncate">
              <SubjectText text={[{ id: first.elementId }]} revit={[first.elementId]} owner={id} />
              <span className="text-ink-2">
                {" "}
                · {s.legIds.length} legs{s.unpricedLegs ? ` · ${s.unpricedLegs} unpriced` : ""}
              </span>
            </span>
            <span className="face-mono text-right">{s.cfm ?? "—"}</span>
            <span className="face-mono text-right">{ft(s.telFt)}</span>
            <span className="face-mono text-right" title="known loss of this section, in-wg">
              {pressure(s.knownInWg)}
            </span>
            <span
              className="face-mono text-right text-ink-2"
              title="cumulative from the fan, in-wg"
            >
              {pressure(cumulative)}
            </span>
            <span
              className="face-mono text-right"
              data-tone={s.overLegIds.length ? "alarm" : undefined}
            >
              {fpm(s.maxFpm)}
            </span>
          </div>
        );
      })}
    </>
  );
}

function SideTable({ ws, side, doc }: { ws: Ws; side: Side; doc: string }) {
  const { runs, worstKnownInWg } = ws[side];
  const selected = useAttention(doc).selected;
  // Ruling C: a picked section opens under the critical run holding it; other runs through it are marked.
  const picked = new Set(
    [...selected].filter((k) => k.startsWith("section:")).map((k) => k.slice(8)),
  );
  const holds = (run: Run) => run.sectionIds.some((id) => picked.has(id));
  const opener = runs.find((r) => r.critical && holds(r)) ?? runs.find(holds);
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(runs.filter((r) => r.critical).map((r) => r.id)),
  );
  const limit = side === "supply" ? ws.limits.supplyFpm : ws.limits.returnFpm;
  if (!runs.length) return null;
  return (
    <section aria-label={`${side} worksheet`} data-worksheet={side} className="flex flex-col">
      <header className="flex items-baseline gap-3">
        <h3 className="t-head">{side}</h3>
        <span className="t-small face-mono text-ink-2">
          {runs.filter((r) => r.end.kind === "terminal").length} runs · worst known{" "}
          {pressure(worstKnownInWg)} in-wg · over {limit} fpm ({ws.limits.source})
        </span>
      </header>
      <div role="table">
        <div role="row" className={`${ROW} t-small text-ink-2`}>
          <span />
          <span>run to</span>
          <span className="text-right">cfm</span>
          <span className="text-right">TEL ft</span>
          <span className="text-right">loss</span>
          <span
            className="text-right"
            title="the worst run's known loss minus this run's: what its balancing must burn"
          >
            residual
          </span>
          <span className="text-right">max fpm</span>
        </div>
        {runs.map((run) => {
          const isOpen = open.has(run.id) || run === opener;
          return (
            <div key={run.id}>
              <div
                role="row"
                className={`${ROW} cursor-pointer`}
                data-run={run.id}
                data-critical={run.critical ? "" : undefined}
                data-marked={picked.size && holds(run) && run !== opener ? "" : undefined}
                {...mention({ doc, key: `run:${run.id}` as SubjectKey })}
                onClick={() =>
                  setOpen((s) => {
                    const next = new Set(s);
                    if (next.has(run.id)) next.delete(run.id);
                    else next.add(run.id);
                    return next;
                  })
                }
              >
                <span
                  className="face-mono"
                  title={run.critical ? "critical: the worst known run on this side" : run.end.kind}
                >
                  {run.critical ? "◆" : run.end.kind === "terminal" ? "○" : "·"}
                </span>
                <span className="min-w-0 truncate">
                  <EndName run={run} />
                  {!run.complete && <span className="t-small text-ink-2"> · incomplete</span>}
                </span>
                <span className="face-mono text-right">{run.cfm ?? "—"}</span>
                <span className="face-mono text-right">{ft(run.telFt)}</span>
                <span
                  className="face-mono text-right"
                  title={run.complete ? "complete" : "known so far; gaps on this run are below"}
                >
                  {pressure(run.knownInWg)}
                </span>
                <span className="face-mono text-right">
                  {run.residualInWg == null ? "" : pressure(run.residualInWg)}
                </span>
                <span
                  className="face-mono text-right"
                  data-tone={run.overLegIds.length ? "alarm" : undefined}
                >
                  {fpm(run.maxFpm)}
                </span>
              </div>
              {isOpen && <SectionRows ws={ws} run={run} side={side} doc={doc} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Worksheet({ ws }: { ws: Ws | null }) {
  const doc = useContext(AttentionDocument) ?? "";
  if (!ws) return <p className="t-small text-ink-2">Reading the worksheet…</p>;
  return (
    <div className="flex flex-col gap-3" data-worksheet="">
      {/* Keyed by basis: a new sheet starts with its own critical runs open. */}
      <SideTable key={`${ws.basis}:supply`} ws={ws} side="supply" doc={doc} />
      <SideTable key={`${ws.basis}:return`} ws={ws} side="return" doc={doc} />
    </div>
  );
}
