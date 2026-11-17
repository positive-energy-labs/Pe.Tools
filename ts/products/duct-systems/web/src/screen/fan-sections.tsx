import { useContext } from "react";
import { DuctsOwner } from "../pane-context.tsx";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { fansLink } from "@pe/fans-contract/link";
import { useRouteSearchSlice } from "../../../../../apps/web/src/route/activity.tsx";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
import { RevitTarget } from "@pe/kit/lang/revit-target";
import { useNativeObservation } from "../../../../../apps/web/src/revit/observation.tsx";
/**
 * A system's fans, in words: one line per fan calc that reaches one of the system's terminals, in
 * roster order, each with its own flow, TEL and required ESP. A calc that is not complete says so and
 * shows its known subtotal; no fan owns a shared trunk (MAP invariant 6).
 */
import { reaches, runsOf, worstRun, type RunScope } from "@pe/ducts-domain/calc-runs";

import type { Priced } from "@pe/ducts-web/priced";
import { fmtFt } from "./bar.tsx";

export interface FanFact {
  key: string;
  unit: number;
  /** "fan" when its calc is complete, else what the claim is. */
  role: string;
  /** Required ESP on a complete calc; else the calc's known subtotal, the bar's length only. */
  esp: number;
  complete: boolean;
  /** The calc claim's kind: `complete`, `to-boundary` or `incomplete`. */
  claim: string;
  /** How many blockers stand on the calc; 0 on a complete one. */
  blockers: number;
  cfm: number | null;
  tel: number | null;
  says: string;
  end: string;
}

/** Every fan port whose calc reaches `scope` by any path (to a grille, an open end or another fan), in roster order. */
export function fanFacts(priced: Priced | null, scope: RunScope | null): FanFact[] {
  if (!priced || !scope) return [];
  const runs = runsOf(priced.calcs);
  return priced.calcs.flatMap((calc) => {
    const unit = calc.fan.unitId;
    // A unit's ports are separate calcs: port 1 never borrows port 0's paths.
    if (!runs.some((r) => r.unit === unit && r.port === calc.fan.portIndex && reaches(r, scope)))
      return [];
    const run = worstRun(priced.calcs, scope.terminals, calc.fan);
    const blockers = calc.blockers.length;
    const held = blockers ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : "";
    const complete = calc.claim.kind === "complete";
    const esp = calc.claim.kind === "complete" ? calc.claim.requiredEspInWg : calc.claim.knownInWg;
    const tel = run?.tel ?? null;
    const shared = calc.encounters.length ? " · meets another fan" : "";
    return {
      key: `${unit}:${calc.fan.portIndex}`,
      unit,
      end: shared.slice(3),
      esp,
      complete,
      claim: calc.claim.kind,
      cfm: calc.fan.flowCfm,
      tel,
      blockers,
      role: complete ? "fan" : `fan · ${calc.claim.kind}${held}`,
      says: `${calc.fan.flowCfm ?? "no"} cfm · TEL ${fmtFt(tel)} ft · ${complete ? "ESP" : "known"} ${esp.toFixed(3)} in-wg${shared}`,
    };
  });
}

/** Each fan's independent pressure, on the largest fan pressure's scale. */
export function FanFacts({
  facts,
  nameOf,
}: {
  facts: readonly FanFact[];
  nameOf: (id: number) => string;
}) {
  const observation = useNativeObservation();
  const owner = useContext(DuctsOwner);
  const search = useRouteSearchSlice((search) => search);
  const roster = owner?.fanRoster ?? [];
  if (!facts.length) return null;
  const scale = Math.max(...facts.map((fact) => fact.esp), 0);
  return (
    <div data-e-fans="">
      {facts.map((fact) => {
        const share = scale > 0 ? fact.esp / scale : 0;
        return (
          <LeaderDiagram
            key={fact.key}
            label={nameOf(fact.unit)}
            items={[
              {
                key: String(fact.unit),
                at: [share / 2],
                size: share,
                label: (
                  <RevitTarget scope={observation.scope} ids={[fact.unit]}>
                    <TooltipHint content={fact.says}>
                      <span>
                        <a
                          href={fansLink(
                            roster.filter((row) => row.unitId === fact.unit).map(stableFanKey),
                            search,
                          )}
                        >
                          {nameOf(fact.unit)}
                        </a>{" "}
                        <span className="text-ink-2">
                          {fact.role} {fact.end}
                        </span>
                      </span>
                    </TooltipHint>
                  </RevitTarget>
                ),
                value: (
                  <>
                    {fact.cfm ?? "\u2014"} cfm &middot; {fmtFt(fact.tel)} ft &middot;{" "}
                    {fact.complete ? "" : "known "}
                    {fact.esp.toFixed(3)} in-wg
                  </>
                ),
              },
            ]}
          />
        );
      })}
    </div>
  );
}
