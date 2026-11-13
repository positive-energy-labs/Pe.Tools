import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { hostActions } from "../src/semantic-actions.ts";
import { familyReads } from "../src/family-actions.ts";
import { scheduleReads } from "../src/schedule-actions.ts";
import type { Command } from "../src/command.ts";
import type { CatalogAxes } from "../src/catalog.ts";
import type { WriteBoundaryBinding } from "../src/write-intent.ts";

type Definition = Command & { writeBoundary?: WriteBoundaryBinding };
type Native = (typeof hostOpCatalog)[number] | (typeof tsOnlyOperationCatalog)[number];
type Row = { axes: CatalogAxes; effect: CatalogAxes["effect"]; plan?: string; via: "command" | { route: string } };
const effects = ["Read", "TransactRead", "SessionWrite", "WorkWrite", "ModelWrite"];
const costs = ["Cheap", "Bounded", "Expensive", "Mutation"];
const max = <T extends string>(values: readonly T[], order: readonly string[]): T =>
  values.reduce((a, b) => order.indexOf(a) >= order.indexOf(b) ? a : b);

/** Generation consumes the native catalog, never C# syntax or a second native effect table. */
export function generateCommandTable(
  definitions: Readonly<Record<string, Definition>> = hostActions,
  catalog: readonly Native[] = [...hostOpCatalog, ...tsOnlyOperationCatalog],
): Record<string, Row> {
  const native = new Map<string, Native>(catalog.map((op) => [op.key, op]));
  const table: Record<string, Row> = {};
  for (const op of catalog) {
    if (Object.hasOwn(definitions, op.key)) continue;
    if (!effects.includes(op.effect)) throw Error(`${op.key}: invalid native effect ${op.effect}`);
    const axes: CatalogAxes = {
      subject: op.subject as CatalogAxes["subject"],
      touches: op.touches.split(", ") as CatalogAxes["touches"],
      effect: op.effect as CatalogAxes["effect"], cost: op.costTier, cardinality: "One",
      ...(op.rollsBack ? { rollsBack: true } : {}),
    };
    table[op.key] = { axes, effect: axes.effect, via: "command" };
  }
  for (const [key, action] of Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b))) {
    const boundary = action.writeBoundary;
    const keys = action.native ?? (native.has(key) ? [key] : []);
    const leaves = keys.map((key) => {
      const leaf = native.get(key);
      if (!leaf) throw Error(`Unknown native command dependency: ${key}`);
      return leaf;
    });
    // A generated preview without an explicit leaf rehearses the write, never assumes Read.
    const rehearsal = boundary?.phase === "preview" && !leaves.length;
    const nativeEffect = leaves.length ? max(leaves.map((op) => op.effect), effects) : undefined;
    const implicitPreview = boundary?.phase === "preview" && key === boundary.key + ".preview";
    const effect = rehearsal || (implicitPreview && nativeEffect === "ModelWrite") ? "TransactRead" : leaves.length
      ? max(leaves.map((op) => op.effect), effects)
      : action.effect === "query" ? "Read" : key.startsWith("findings.") ? "WorkWrite" : "SessionWrite";
    if (!effects.includes(effect)) throw Error(`${key}: invalid native effect ${effect}`);
    const axes: CatalogAxes = {
      subject: (leaves.find((op) => op.subject !== "None")?.subject ?? "None") as CatalogAxes["subject"],
      touches: [...new Set(leaves.length ? leaves.flatMap((op) => op.touches.split(", ")) : ["Metadata"])] as CatalogAxes["touches"],
      effect: effect as CatalogAxes["effect"],
      cost: leaves.length ? max(leaves.map((op) => op.costTier), costs) : action.effect === "query" ? "Bounded" : "Mutation",
      // Command admission is bounded to one target; native collectors keep their own cardinality.
      cardinality: "One",
      ...(effect === "TransactRead" ? { rollsBack: true } : {}),
    };
    // A semantic command can persist host state around a native read (captures and cached reads).
    if (!boundary && action.effect === "command" && (axes.effect === "Read" || axes.effect === "TransactRead")) {
      axes.effect = "SessionWrite";
      delete axes.rollsBack;
    }
    const route = key.startsWith("action.") ? key === "action.read" ? "actions.read" : key
      : key === "page.bind" ? key : key === "ops.read" ? "operation.call"
      : Object.hasOwn(familyReads, key) ? "/family/readings"
      : Object.hasOwn(scheduleReads, key) ? "/schedules/readings" : undefined;
    table[key] = { axes, effect: axes.effect, ...(boundary?.phase === "apply" ? { plan: boundary.previewKey } : {}),
      via: route ? { route } : "command" };
  }
  for (const [key, action] of Object.entries(definitions)) {
    const boundary = action.writeBoundary;
    if (!boundary) continue;
    const row = table[key]!;
    if (boundary.phase === "preview") {
      // Plans use the write footprint so catalog admission can check correspondence.
      row.axes.subject = table[boundary.key]!.axes.subject;
      row.axes.touches = table[boundary.key]!.axes.touches;
    }
    const allowed = boundary.phase === "apply" ? ["ModelWrite"] : ["Read", "TransactRead"];
    if (!allowed.includes(row.effect)) throw Error(`${key}: ${boundary.phase} boundary cannot be ${row.effect}`);
  }
  return table;
}

export function commandTableSource(table = generateCommandTable()): string {
  return '// Generated by scripts/command-axes.ts. Do not edit.\n'
    + 'export const commandTable = {\n'
    + Object.entries(table).map(([key, row]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(row) + ',').join('\n')
    + '\n} as const;\n'
    + 'export const commandCatalogAxes = {\n'
    + Object.keys(table).map((key) => '  ' + JSON.stringify(key) + ': commandTable[' + JSON.stringify(key) + '].axes,').join('\n')
    + '\n};\n';
}
const destination = fileURLToPath(new URL("../src/generated/command-axes.generated.ts", import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const source = commandTableSource();
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8").replace(/\r\n/g, "\n") !== source) {
      throw Error("Command metadata is stale. Run @pe/agent-contracts codegen.");
    }
  } else writeFileSync(destination, source);
}
