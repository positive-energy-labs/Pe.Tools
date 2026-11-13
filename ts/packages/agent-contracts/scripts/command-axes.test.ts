import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { generateCommandTable, commandTableSource } from "./command-axes.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { hostActions } from "../src/semantic-actions.ts";

test("native effect changes flow through generation into browser metadata", () => {
  const source = [...hostOpCatalog, ...tsOnlyOperationCatalog];
  const changed = source.map((op) => op.key === "ducts.assign-fan" ? { ...op, effect: "SessionWrite" as const } : op);
  const definitions = { move: { ...hostActions["ducts.apply-assign-fan"], writeBoundary: undefined } };
  const before = generateCommandTable(definitions, source);
  const after = generateCommandTable(definitions, changed);
  expect(before.move!.effect).toBe("ModelWrite");
  expect(after.move!.effect).toBe("SessionWrite");
  expect(commandTableSource(before)).not.toBe(commandTableSource(after));
});

test("receipt controls select their existing transport and SessionWrite scope", () => {
  const table = generateCommandTable();
  for (const key of ["action.recover", "action.resume", "action.cancel"]) {
    expect(table[key]!.effect).toBe("SessionWrite");
    expect(table[key]!.axes.effect).toBe("SessionWrite");
    expect(table[key]!.via).toEqual({ route: key });
  }
  expect(table["action.read"]!.via).toEqual({ route: "actions.read" });
});

test("findings writes modify Work and plans preserve their native read scope", () => {
  const table = generateCommandTable();
  for (const [key, action] of Object.entries(hostActions)) {
    if (key.startsWith("findings.") && action.effect === "command") expect(table[key]!.effect).toBe("WorkWrite");
  }
  expect(table["sheet.apply"]!.plan).toBe("sheet.plan");
  expect(table["sheet.plan"]!.effect).toBe("Read");
});

test("tracked browser table is fresh and contains data alone", () => {
  const generated = readFileSync(new URL("../src/generated/command-axes.generated.ts", import.meta.url), "utf8");
  expect(generated.replace(/\r\n/g, "\n")).toBe(commandTableSource());
  expect(generated).not.toMatch(/^import\s|Zod|zod|safeParse/m);
});

test("Takeoffs native model writes have a generated plan and the existing write boundary", () => {
  const table = generateCommandTable();
  for (const key of ["takeoffs.initialize", "takeoffs.sync"] as const) {
    expect(table[key]).toMatchObject({ effect: "ModelWrite", plan: key + ".preview" });
    expect(hostActions[key].writeBoundary).toMatchObject({ phase: "apply", previewKey: key + ".preview" });
  }
});
