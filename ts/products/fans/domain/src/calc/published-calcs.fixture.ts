import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildCalc } from "./build.ts";
import { networkCalcs } from "./network-calcs.ts";
import { calcState } from "./state.ts";
import { CALC_ENGINE_VERSION } from "./types.ts";
import { openFanCalcSchema } from "@pe/fans-contract/fans-read";
import retained from "@pe/ducts-domain/fixtures/manual-d-20261102.json" with { type: "json" };
import tables from "@pe/ducts-domain/fixtures/manual-d-tables.json" with { type: "json" };
import { calcSnapshot, VOCABULARY } from "@pe/ducts-domain/calc/scoped-snapshot";
import { withFamilyFlipped } from "@pe/ducts-domain/test-inputs";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";

export const capturePath = new URL("../../../../ducts/domain/src/fixtures/published-calcs.fixture.json", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("./fixtures/published-inputs.json", import.meta.url), "utf8"));
function expand(value: any): any {
  if (Array.isArray(value)) return value.map(expand);
  if (!value || typeof value !== "object") return value;
  if ("$retained" in value) return calcSnapshot(withFamilyFlipped(nativeResponseSchema("ducts.snapshot.walk").parse({
    ...retained, walk: { ...retained.walk, unreadPeers: [] }, vocabulary: VOCABULARY,
  }), value.$retained));
  if ("$tables" in value) return toGrids({ tables });
  if ("$ref" in value) return expand(manifest.blobs[value.$ref]);
  if ("$map" in value) return new Map(expand(value.$map));
  if ("$set" in value) return new Set(expand(value.$set));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
}
const encode = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item instanceof Map ? { $map: [...item] } : item instanceof Set ? { $set: [...item] } : item);
const wire = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? Object.fromEntries(item) : item instanceof Set ? [...item] : item));

export function recompute(): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const cases = expand(manifest.cases);
  for (const key of Object.keys(cases)) {
    const { kind, args } = cases[key];
    const hash = createHash("sha256").update(encode([kind, args])).digest("hex");
    if (hash !== key) throw Error(`Input manifest hash mismatch: ${key} != ${hash}`);
    if (kind === "buildCalc") next[key] = wire(buildCalc(args[0]));
    else if (kind === "networkCalcs") next[key] = wire(networkCalcs(args[0], args[1], args[2], args[3], args[4], args[5]));
    else throw Error(`Unknown recorded call: ${key}/${kind}`);
  }
  const projections = expand(manifest.projections);
  // These are fixed presentation inputs, not engine output. Their calc members come from replay.
  next.roster = projections.roster;
  next.pricing = { ...projections.pricing, calcs: next[projections.pricingCalcs] };
  next.calcView = calcState(openFanCalcSchema.parse(projections.view));
  return next;
}

export function firstDifference(old: any, next: any, path = "$"): string | null {
  if (Object.is(old, next)) return null;
  if (!old || !next || typeof old !== "object" || typeof next !== "object" || Array.isArray(old) !== Array.isArray(next))
    return `${path}: ${JSON.stringify(old)} -> ${JSON.stringify(next)}`;
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    const difference = firstDifference(old[key], next[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}
export function checkVersions(value: any, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if ("engineVersion" in value && value.engineVersion !== CALC_ENGINE_VERSION)
    throw Error(`${path}.engineVersion: ${value.engineVersion} != ${CALC_ENGINE_VERSION}`);
  for (const key of Object.keys(value)) checkVersions(value[key], `${path}.${key}`);
}
// Run after any engine change: PE_REGENERATE_CALCS=1 vp test published-calcs.test.ts --maxWorkers=1
export function regenerate(next: Record<string, unknown>): void {
  writeFileSync(capturePath, JSON.stringify(next) + "\n");
}
