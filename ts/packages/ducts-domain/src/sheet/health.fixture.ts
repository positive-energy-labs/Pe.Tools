/**
 * Test-only: C#'s model health for the sheet's synthetic snapshots (ducts LEDGER 2026-10-29: C#
 * owns model health, so a synthetic graph gets its open ends' neighbourhoods from the C# producer,
 * never from TypeScript geometry). Each synthetic graph (nodes, segments, tolerances) is keyed by
 * a hash; `fixtures/synthetic-health.json` holds what `DuctHealth.Assess` returned for it.
 * To add or change one: run the TypeScript tests with PE_WRITE_FIXTURES=1 (they record each
 * unknown graph to `fixtures/synthetic-health-inputs.json`), then run dotnet
 * `DuctHealthTests.Synthetic_sheet_health` with PE_WRITE_FIXTURES=1 through `pe-revit test`, and
 * re-run the TypeScript tests.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DuctSnapshot } from "../types.ts";

const DIR = join(__dirname, "fixtures");
const OUT = join(DIR, "synthetic-health.json");
const IN = join(DIR, "synthetic-health-inputs.json");
type Health = Pick<DuctSnapshot, "issues" | "tolerances">;
type Input = {
  nodes: readonly unknown[];
  segments: readonly unknown[];
  /** Overrides only; C# owns the defaults. */
  tolerances?: { candidateBoxIn?: number; autoJoinGapIn?: number };
};

const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};
const read = <T>(file: string): Record<string, T> =>
  existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, T>) : {};

/** `s` with the C# producer's issues and tolerances for its graph. */
export function withHealth<T extends Pick<DuctSnapshot, "nodes" | "segments">>(
  s: T,
  tolerances?: Input["tolerances"],
): T & Health {
  const input: Input = {
    nodes: s.nodes,
    segments: s.segments,
    ...(tolerances ? { tolerances } : {}),
  };
  const json = JSON.stringify(input);
  const key = `${fnv(json)}-${json.length}`;
  const health = read<Health>(OUT)[key];
  if (health) return { ...s, ...health };
  if (process.env.PE_WRITE_FIXTURES === "1") {
    writeFileSync(IN, `${JSON.stringify({ ...read<Input>(IN), [key]: input }, null, 1)}\n`);
    return { ...s, issues: [] } as T & Health;
  }
  throw new Error(
    `no C# health for synthetic graph ${key}; see health.fixture.ts to record it (PE_WRITE_FIXTURES=1)`,
  );
}
