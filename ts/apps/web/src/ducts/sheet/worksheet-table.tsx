/**
 * The worksheet (ducts LEDGER 2026-10-29, "TS"): per side, one row per run from the fan to an end,
 * critical first; a row opens into its sections, the stretches of constant flow between
 * junctions. Rows are Subjects (`run:<id>`, `section:<id>`), so hovering one lights it in the
 * picture once the sheet registers their members. Velocity over the limit is the one alarm ink;
 * the page paints nothing else. A 3D pick that selects a `section:` opens it under the critical
 * run that holds it and marks the other runs through it (ruling C). A terminal run's cfm is the
 * one design value edited where it bites (ducts LEDGER 2026-10-29): the cell writes Work `flows`
 * and shows the resolved source; the host recomputes.
 */
import { useContext, useState } from "react";
import type { DuctsInputs, DuctsSheetEdits } from "@pe/agent-contracts";
import { AttentionDocument, mention, useAttention, type SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { nameOrFallback, SubjectText } from "@pe/kit/lang/subject-text";
import { delivers } from "@pe/ducts-domain/sheet/worksheet";
import { pressure, type Detail } from "./model";
import { SheetCell } from "./sheet-cell";

type Ws = Detail<"worksheet">;
type Side = "supply" | "return";
type Run = Ws["supply"]["runs"][number];
type Section = Ws["supply"]["sections"][number];

const ft = (v: number) => v.toFixed(0);

/** What the table needs to edit a design value: the resolved inputs and the one write. */
export interface WorksheetEditing {
  inputs: DuctsInputs | null;
  changeInputs: (edits: DuctsSheetEdits) => void;
  busy: boolean;
}

/**
 * Where a terminal run's flow came from when the terminal states none of its own: a terminal its
 * siblings share carries the sum of its consumers' draws (R-SHARE, build.ts), any other the
 * balance or split the engine took. Read from the end leg's `flowSource`, never typed.
 */
export function derivedFlowSource(flowSource: string | null): string {
  if (flowSource && /\bsibling\b/.test(flowSource)) return "consumers";
  if (flowSource && /\bbalance\b/.test(flowSource)) return "balance";
  return "derived";
}

/**
 * A terminal run's design cfm: the kit cell, typed in place, cleared by emptying; the source reads
 * beside it. A terminal stating no flow of its own still carries what its run delivers (the Chadds
 * louver 14088043 carries 350, its four ERVs' and MUAS-1's draws): the cell shows that flow with
 * where it came from, an estimate, never the alarm "none" (UI5, 2026-10-29). Typing still writes it.
 */
function CfmCell({ run, ws, editing }: { run: Run; ws: Ws; editing: WorksheetEditing }) {
  if (run.end.kind !== "terminal" || !editing.inputs)
    return <span className={CFM}>{run.cfm ?? "—"}</span>;
  const id = String(run.end.elementId);
  const resolved = editing.inputs.terminals[id]?.cfm;
  const typed = resolved?.source === "typed";
  const stated = resolved?.value != null;
  const carried = !stated && run.cfm != null;
  const flowSource = ws.legs[run.legIds.at(-1) ?? ""]?.flowSource ?? null;
  return (
    <SheetCell
      label={`design cfm at ${id}`}
      value={stated ? resolved!.value : carried ? run.cfm : null}
      unit={{ label: "cfm" }}
      digits={0}
      source={carried ? derivedFlowSource(flowSource) : (resolved?.source ?? null)}
      sourceTitle={
        carried
          ? `${derivedFlowSource(flowSource) === "consumers" ? "consumers' sum" : derivedFlowSource(flowSource)}: ${flowSource ?? "no source"}`
          : undefined
      }
      refusal={editing.busy ? "Wait for the current read" : null}
      clearable={typed}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-1"
      onValue={(value) =>
        editing.changeInputs({ flows: { [id]: value == null ? null : { cfm: value } } })
      }
    />
  );
}
const fpm = (v: number | null) => (v == null ? "—" : v.toFixed(0));
/** A read-only cfm sits where the editable cell's box does, so the column reads as one. */
const CFM = "face-mono block w-[4.5rem] text-right";
/**
 * Numbers never give way; names do (UI5, 2026-10-29: at 1600 px with chat and the fans column
 * open the ledger is ~24rem and lost loss, residual and fpm). The table is a size container: wide,
 * one line per row; narrow, the name takes its own line over the numbers (`NAME`), which keep
 * their columns. The full name is the row's title.
 */
const ROW =
  "grid grid-cols-[0.75rem_9.5rem_2.25rem_3rem_3rem_2.25rem] items-center gap-x-1.5 py-0.5 @[32rem]:grid-cols-[0.75rem_minmax(8rem,1fr)_10rem_2.25rem_3rem_3rem_2.25rem]";
const NAME = "order-first col-span-full min-w-0 truncate @[32rem]:order-none @[32rem]:col-span-1";

/** What an end is, in a word; the other fan named after it. */
const END_WORD: Record<Run["end"]["kind"], string> = {
  terminal: "",
  "open-end": "open end",
  "roster-fan-port": "fan",
  "joins-other-fan": "joins",
  "sibling-fan": "sibling",
};

/** The text a row's name shows, for its title when the name gives way. */
function useEndTitle(): (run: Run) => string {
  const namer = useContext(SubjectTextContext)?.nameOf;
  const name = (id: number) => nameOrFallback(namer?.(id));
  return ({ end, complete }) =>
    `${
      end.kind === "terminal"
        ? `${name(end.elementId)}${end.connector == null ? "" : ` port ${end.connector}`}`
        : [END_WORD[end.kind], end.fan ? name(end.fan.unitId) : name(end.elementId)].join(" ")
    }${complete ? "" : " · incomplete"}`;
}

/**
 * The side's caption counts the rows it shows: the runs that deliver (terminals, other fans'
 * ports, streams joined; `delivers`), then the rows that do not, by word. MUAS-1's supply read
 * "0 runs" over three runs to RV-7, RV-15 and FC-23 when only terminals counted (UI5, 2026-10-29).
 */
export function sideCaption(runs: readonly Pick<Run, "end">[]): string {
  const rest = new Map<string, number>();
  for (const r of runs)
    if (!delivers(r.end)) rest.set(END_WORD[r.end.kind], (rest.get(END_WORD[r.end.kind]) ?? 0) + 1);
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    count(runs.filter((r) => delivers(r.end)).length, "run"),
    ...[...rest].map(([word, n]) => count(n, word)),
  ].join(" · ");
}

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
      {END_WORD[end.kind]}
      {!end.fan && (
        <>
          {" "}
          <SubjectText
            text={[{ id: end.elementId, connector: end.connector }]}
            revit={[end.elementId]}
            owner={`${run.id}:end`}
          />
        </>
      )}
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
  const namer = useContext(SubjectTextContext)?.nameOf;
  const nameOf = (id: number) => nameOrFallback(namer?.(id));
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
            className={`${ROW} t-small`}
            data-section={id}
            {...mention({ doc, key: `section:${id}` as SubjectKey })}
          >
            <span
              className="face-mono text-ink-2"
              title={`${s.runIds.length} runs share this section`}
            >
              {s.runIds.length > 1 ? `×${s.runIds.length}` : ""}
            </span>
            <span
              className={`${NAME} pl-4`}
              title={`${nameOf(first.elementId)} · ${s.legIds.length} legs`}
            >
              <SubjectText text={[{ id: first.elementId }]} revit={[first.elementId]} owner={id} />
              <span className="text-ink-2">
                {" "}
                · {s.legIds.length} legs{s.unpricedLegs ? ` · ${s.unpricedLegs} unpriced` : ""}
              </span>
            </span>
            <span className={CFM}>{s.cfm ?? "—"}</span>
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

function SideTable({
  ws,
  side,
  doc,
  editing,
}: {
  ws: Ws;
  side: Side;
  doc: string;
  editing: WorksheetEditing;
}) {
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
  const title = useEndTitle();
  if (!runs.length) return null;
  return (
    <section
      aria-label={`${side} worksheet`}
      data-worksheet={side}
      className="flex min-w-0 flex-col"
    >
      <header className="flex items-baseline gap-3">
        <h3 className="t-head">{side}</h3>
        <span className="t-small face-mono text-ink-2" data-worksheet-caption={side}>
          {sideCaption(runs)} · worst known {pressure(worstKnownInWg)} in-wg · over {limit} fpm (
          {ws.limits.source})
        </span>
      </header>
      {/* The table is the size container its rows answer to; below its numbers' width it scrolls. */}
      <div role="table" className="@container min-w-0 overflow-x-auto">
        <div className="min-w-[23rem]">
          <div role="row" className={`${ROW} t-small text-ink-2`}>
            <span />
            <span className={NAME}>run to</span>
            <span className="block w-[4.5rem] text-right">cfm</span>
            <span className="text-right" title="total equivalent length, ft">
              TEL
            </span>
            <span className="text-right" title="known loss of the run, in-wg">
              loss
            </span>
            <span
              className="text-right"
              title="the worst run's known loss minus this run's: what its balancing must burn"
            >
              resid.
            </span>
            <span className="text-right" title="max velocity on the run, fpm">
              fpm
            </span>
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
                    title={
                      run.critical
                        ? "critical: the worst known run on this side"
                        : END_WORD[run.end.kind] || "terminal"
                    }
                  >
                    {run.critical ? "◆" : run.end.kind === "terminal" ? "○" : "·"}
                  </span>
                  <span className={NAME} title={title(run)}>
                    <EndName run={run} />
                    {!run.complete && <span className="t-small text-ink-2"> · incomplete</span>}
                  </span>
                  <CfmCell run={run} ws={ws} editing={editing} />
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
      </div>
    </section>
  );
}

export function Worksheet({ ws, editing }: { ws: Ws | null; editing: WorksheetEditing }) {
  const doc = useContext(AttentionDocument) ?? "";
  if (!ws) return <p className="t-small text-ink-2">Reading the worksheet…</p>;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-worksheet="">
      {/* Keyed by basis: a new sheet starts with its own critical runs open. */}
      <SideTable key={`${ws.basis}:supply`} ws={ws} side="supply" doc={doc} editing={editing} />
      <SideTable key={`${ws.basis}:return`} ws={ws} side="return" doc={doc} editing={editing} />
    </div>
  );
}
