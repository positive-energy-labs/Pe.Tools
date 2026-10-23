import { TooltipHint } from "@pe/kit/lang/tooltip";
import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
import { RevitTarget } from "@pe/kit/lang/row";
import { useNativeObservation } from "#/revit/observation";
/**
 * A system's fans (ducts-domain `fan-sections.ts`), in words: one line per fan, largest design flow
 * first, each with its own TEL and ESP and where it ends. The largest fan owns the trunk; a smaller
 * fan owns its port to the junction where its air meets a larger fan's. The sidebar no longer
 * carries them as cards (kaitpw 2026-10-23: "only takes up space"): they read in the system row's
 * breakdown popover and on each unit's Inputs row.
 */
import type { Priced } from "@pe/ducts-domain/pricing";
import type { FanResult } from "@pe/ducts-domain/losses";

import { fmtFt } from "./bar";

export interface FanFact {
  unit: number;
  /** "largest fan" with several fans in its group, else "fan". */
  role: string;
  esp: number;
  cfm: number | null;
  tel: number | null;
  says: string;
  end: string;
}

/** Every fan of these groups, in each group's largest-first order. */
export function fanFacts(
  priced: Priced | null,
  groups: readonly string[],
  nameOf: (id: number) => string,
): FanFact[] {
  return groups.flatMap((g) => {
    const fans: readonly FanResult[] = priced?.next.byGroup[g]?.fans ?? [];
    return fans.map((f, k) => {
      const where =
        fans.length < 2
          ? ""
          : k === 0
            ? " · owns the trunk"
            : f.junction == null
              ? " · meets no larger fan"
              : ` · to ${nameOf(f.junction)}${f.viaJunction ? ", then the trunk" : ""}`;
      return {
        unit: f.unit,
        end: where.slice(3),
        esp: f.esp,
        cfm: f.cfm,
        tel: f.tel,
        role: fans.length > 1 && k === 0 ? "largest fan" : "fan",
        says: `${f.cfm ?? "no"} cfm · TEL ${fmtFt(f.tel)} ft · ESP ${f.esp.toFixed(3)} in-wg${where}`,
      };
    });
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
  if (!facts.length) return null;
  const scale = Math.max(...facts.map((fact) => fact.esp), 0);
  return (
    <div data-e-fans="">
      {facts.map((fact) => {
        const share = scale > 0 ? fact.esp / scale : 0;
        return (
          <LeaderDiagram
            key={fact.unit}
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
                        {nameOf(fact.unit)}{" "}
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
