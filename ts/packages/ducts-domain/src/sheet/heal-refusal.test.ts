/**
 * R-A and R-B (kaitpw 2026-10-28) on the retained raw Chadds snapshot, FC-23 (unit 8732550,
 * port 1, slot `revit:Flow`). Skipped when the file is absent, like the host's ducts-sheet test.
 *
 * Terrain (walk probe, 2026-10-28): FC-23's supply trunk is a branch into the side of its own
 * duct 12871538 at takeoff 13415684 (depth 5). Under R-Q4 that is a split, so the trunk's open
 * end 13756998:0 is on the sheet in both passes; the raw-walk assertions below predate that.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

import { suggestRoster } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import { buildSheet } from "./index.ts";
import { grids } from "./tables.fixture.ts";
import { foreignOwners, graphOf, walkFrom } from "./walk.ts";

const CHADDS =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
const FC23 = 8732550;
const OTHER_FC23 = 13760867;

it.skipIf(!existsSync(CHADDS))(
  "FC-23 on Chadds: no tee or tap onto another roster fan's network; assumed-only blockers cite their cause",
  () => {
    const snap = (
      JSON.parse(readFileSync(CHADDS, "utf8").replace(/^\uFEFF/, "")) as { result: DuctSnapshot }
    ).result;
    const r = suggestRoster(snap);
    const roster = [...r.fans, ...r.suggestions];
    const g = graphOf(snap);
    const unit = g.byId.get(FC23)!;
    const owners = foreignOwners(g, roster, unit);
    // 13770538 is on the other FC-23's trunk (it shares a component with RV-14; the nearer fan names it).
    expect(owners.get(13770538)?.unitId).toBe(OTHER_FC23);
    expect(owners.has(13756998)).toBe(false);

    // R-A on the raw walk, both passes: the tee at 13756998:0 is refused and the end stays open.
    for (const assumeHeals of [false, true]) {
      const w = walkFrom(g, unit, 1, { roster, assumeHeals, owners });
      const open = w.blockers.get("open-end:13756998:0")!;
      expect(open.kind).toBe("open-end");
      expect(open.closer.kind).toBe("ruling");
      expect(open.closer.note).toBe(
        `nearest candidate is 13770538:0 on FC-23 (${OTHER_FC23})'s network; a tee there would merge streams (Q4); rule in Revit`,
      );
      expect(open.proposal).toBeUndefined();
      expect(w.heals.some((h) => h.proposal.from.elementId === 13756998)).toBe(false);
      expect(w.depth.has(OTHER_FC23)).toBe(false);
    }

    const sheet = buildSheet({
      snapshot: snap,
      fan: { unitId: FC23, portIndex: 1 },
      roster,
      grids,
      slot: "revit:Flow",
    });
    // No assumed heal lands on another roster fan's network; a join may (its owner is not checked).
    const heals = sheet.inputs
      .filter((i) => i.source === "assumed heal")
      .map((i) => /^(join|tap|tee) \S+ to (\d+)/.exec(i.name)!)
      .map((m) => ({ kind: m[1]!, to: Number(m[2]) }));
    expect(heals.length).toBeGreaterThan(0);
    expect(heals.filter((h) => h.kind !== "join" && owners.has(h.to))).toEqual([]);
    expect(heals.some((h) => owners.get(h.to)?.unitId === OTHER_FC23)).toBe(false);
    expect(sheet.inputs.some((i) => i.name.startsWith("tee 13756998:0"))).toBe(false);
    // Nothing on either pass reaches the other fan's grille branch.
    const all = [...sheet.blockers, ...sheet.assumed.blockers];
    expect(all.some((b) => b.elementId === 13885163)).toBe(false);
    expect(sheet.walkedElementIds).not.toContain(13885163);
    expect(sheet.walkedElementIds).not.toContain(OTHER_FC23);

    // R-B: the known pass carries no causedBy; every assumed-only blocker cites a known blocker id.
    const known = new Set(sheet.blockers.map((b) => b.id));
    expect(sheet.blockers.every((b) => b.causedBy == null)).toBe(true);
    const assumedOnly = sheet.assumed.blockers.filter((b) => !known.has(b.id));
    expect(assumedOnly.length).toBeGreaterThan(0);
    for (const b of assumedOnly) {
      expect(b.causedBy, b.id).toBeDefined();
      expect(known.has(b.causedBy!), `${b.id} cites ${b.causedBy}`).toBe(true);
    }
    // Before R-A (probe 2026-10-28): known 3, assumed 8 with the tee and a tap beyond it. After
    // R-A: 3 and 7. After R-Q4 the assumed tap heal at 8738359:1 walks on instead of ending as a
    // merge, and its no-flow share is gone: 3 and 6.
    expect(sheet.blockers.length).toBe(3);
    expect(sheet.assumed.blockers.length).toBe(6);
  },
  120_000,
);
