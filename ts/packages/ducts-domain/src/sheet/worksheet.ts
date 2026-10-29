/**
 * The worksheet (ducts LEDGER 2026-10-29): one row per run, a path from the fan port to one end,
 * each opening into its sections. A section is a stretch of constant flow between junctions:
 * consecutive legs carried by the same set of runs, which is where the runs' centerlines, drawn
 * side by side, keep the same count. Pure over a built Sheet; the picture and the table read the
 * same ids (`run.id`, `section.id`).
 */
import type { Leg, Sheet, SheetPath, Side } from "./types.ts";

/** Velocity above which a leg is "over" (the one thing the picture paints); firm defaults. */
export interface WorksheetLimits {
  maxFpm: Record<Side, number>;
}

export interface WorksheetSection {
  /** `${side}:${first leg id}`: a section is named by where it starts, walking from the fan. */
  id: string;
  side: Side;
  /** Walk order, from the fan. */
  legIds: string[];
  runIds: string[];
  cfm: number | null;
  knownInWg: number;
  /** Legs with no loss yet; the section's known sum excludes them. */
  unpricedLegs: number;
  telFt: number;
  maxFpm: number | null;
  overLegIds: string[];
}

export interface WorksheetRun {
  id: string;
  side: Side;
  end: SheetPath["end"];
  legIds: string[];
  sectionIds: string[];
  /** The flow delivered at the end: the last leg's. */
  cfm: number | null;
  telFt: number;
  knownInWg: number;
  complete: boolean;
  /** The worst terminal run's known loss minus this one's: what this run's balancing must burn. Terminal runs only. */
  residualInWg: number | null;
  /** The worst known terminal run on its side. */
  critical: boolean;
  maxFpm: number | null;
  overLegIds: string[];
}

export interface WorksheetSide {
  runs: WorksheetRun[];
  sections: WorksheetSection[];
  worstKnownInWg: number | null;
  /**
   * The sections each walked element sits in, the critical run's first (ducts LEDGER 2026-10-29, C):
   * a 3D pick on an element selects its first section and opens it under the critical run. A tee
   * crossed by two runs on different port pairs sits in two sections. Keys are element ids.
   */
  elementSections: Record<string, string[]>;
}

export type Worksheet = Record<Side, WorksheetSide>;

const sum = (legs: readonly Leg[], pick: (l: Leg) => number | null) =>
  legs.reduce((a, l) => a + (pick(l) ?? 0), 0);
const maxOf = (legs: readonly Leg[]) => {
  const v = legs.flatMap((l) => (l.velocityFpm == null ? [] : [l.velocityFpm]));
  return v.length ? Math.max(...v) : null;
};

export function worksheet(sheet: Sheet, limits: WorksheetLimits): Worksheet {
  const side = (s: Side): WorksheetSide => {
    const paths = sheet.paths.filter((p) => p.side === s);
    const leg = (id: string) => {
      const l = sheet.legs[id];
      if (!l) throw new Error(`worksheet: path names leg ${id}, which the sheet does not carry`);
      return l;
    };
    const over = (legs: readonly Leg[]) =>
      legs.filter((l) => l.velocityFpm != null && l.velocityFpm > limits.maxFpm[s]).map((l) => l.id);
    const seen = new Map<string, number>();
    const ids = paths.map((p) => {
      const base = `${s}:${p.end.kind}:${p.end.elementId}:${p.end.connector ?? ""}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n ? `${base}#${n}` : base;
    });
    const carriers = new Map<string, string[]>();
    paths.forEach((p, i) =>
      p.legIds.forEach((id) => carriers.set(id, [...(carriers.get(id) ?? []), ids[i]!])),
    );
    const key = (id: string) => carriers.get(id)!.join("|");

    const sections = new Map<string, WorksheetSection>();
    const sectionIds = paths.map((p) => {
      const mine: string[] = [];
      let open: WorksheetSection | undefined;
      for (const id of p.legIds) {
        if (!open || key(open.legIds[0]!) !== key(id)) {
          const sid = `${s}:${id}`;
          open = sections.get(sid) ?? {
            id: sid,
            side: s,
            legIds: [],
            runIds: carriers.get(id)!,
            cfm: null,
            knownInWg: 0,
            unpricedLegs: 0,
            telFt: 0,
            maxFpm: null,
            overLegIds: [],
          };
          sections.set(sid, open);
          mine.push(sid);
        }
        if (!open.legIds.includes(id)) open.legIds.push(id);
      }
      return mine;
    });
    for (const sec of sections.values()) {
      const legs = sec.legIds.map(leg);
      sec.cfm = legs[0]?.flowCfm ?? null;
      sec.knownInWg = sum(legs, (l) => l.lossInWg);
      sec.unpricedLegs = legs.filter((l) => l.lossInWg == null).length;
      sec.telFt = sum(legs, (l) => l.equivalentFt);
      sec.maxFpm = maxOf(legs);
      sec.overLegIds = over(legs);
    }

    const terminals = paths.filter((p) => p.end.kind === "terminal");
    const worst = terminals.length ? Math.max(...terminals.map((p) => p.knownInWg)) : null;
    const runs = paths.map((p, i): WorksheetRun => {
      const legs = p.legIds.map(leg);
      const terminal = p.end.kind === "terminal";
      return {
        id: ids[i]!,
        side: s,
        end: p.end,
        legIds: p.legIds,
        sectionIds: sectionIds[i]!,
        cfm: legs.at(-1)?.flowCfm ?? null,
        telFt: sum(legs, (l) => l.equivalentFt),
        knownInWg: p.knownInWg,
        complete: p.complete,
        residualInWg: terminal && worst != null ? worst - p.knownInWg : null,
        critical: terminal && p.knownInWg === worst,
        maxFpm: maxOf(legs),
        overLegIds: over(legs),
      };
    });
    const elementSections: Record<string, string[]> = {};
    for (const run of [...runs].sort((a, b) => Number(b.critical) - Number(a.critical)))
      for (const sid of run.sectionIds)
        for (const id of sections.get(sid)!.legIds) {
          const at = (elementSections[leg(id).elementId] ??= []);
          if (!at.includes(sid)) at.push(sid);
        }
    return { runs, sections: [...sections.values()], worstKnownInWg: worst, elementSections };
  };
  return { supply: side("supply"), return: side("return") };
}
