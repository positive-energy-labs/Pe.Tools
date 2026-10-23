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
  says: string;
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
        role: fans.length > 1 && k === 0 ? "largest fan" : "fan",
        says: `${f.cfm ?? "no"} cfm · TEL ${fmtFt(f.tel)} ft · ESP ${f.esp.toFixed(3)} in-wg${where}`,
      };
    });
  });
}

/** The fans as a small table: the head of a system's breakdown popover. */
export function FanFacts({
  facts,
  nameOf,
}: {
  facts: readonly FanFact[];
  nameOf: (id: number) => string;
}) {
  if (!facts.length) return null;
  return (
    <table className="mb-2 w-full text-left" aria-label="fans" data-e-fans="">
      <tbody className="hairline-rows">
        {facts.map((f) => (
          <tr key={f.unit}>
            <th scope="row" className="py-0.5 pr-2 font-normal whitespace-nowrap">
              {nameOf(f.unit)} <span className="text-ink-2">{f.role}</span>
            </th>
            <td className="face-mono py-0.5">{f.says}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
