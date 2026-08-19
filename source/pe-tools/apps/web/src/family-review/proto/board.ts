/**
 * PROTOTYPE — the fixture adapter. Raw JSON text in, `BoardFamily[]` out.
 *
 * The parse is deliberate: the board holds the SAME text a run wrote, so a schema change breaks it
 * here rather than silently reshaping what the drawings claim.
 */
import type { FamilyModel } from "#/family/family-model";
import type { BoardFamily, Probe } from "#/family-review/model";
import { RAW_BOARD } from "#/family-review/proto/fixtures";

/**
 * WHAT THE BOARD READS FROM, as facts the chrome states out loud rather than implies.
 *
 * The source-of-truth law (ledger, 2026-08-19): a `family.json` may be materialized into many
 * documents across many years, and this surface must NEVER imply it can sync a json to everywhere
 * it has gone. So the board names its ONE reading — this run, this year, this document per family
 * — and says plainly that it writes nowhere.
 */
export const RUN_SOURCE = {
  kind: "checked-in fixture",
  run: "family-oracle-20260819-board",
  date: "2026-08-19",
  year: "R25",
  lane: "fresh",
  suite: "FamilyModelRoundtripTests · 6 passed / 0 failed",
} as const;

export function loadBoard(): BoardFamily[] {
  return RAW_BOARD.map((raw) => {
    const model = JSON.parse(raw.familyJson) as FamilyModel;
    const probes: Record<string, Probe> = {};
    for (const [typeName, text] of Object.entries(raw.probeJson))
      probes[typeName] = JSON.parse(text) as Probe;
    return {
      slug: raw.slug,
      name: model.family.name,
      model,
      probes,
      refusal: raw.refusal,
      documentName: raw.probeVariant,
    };
  });
}
