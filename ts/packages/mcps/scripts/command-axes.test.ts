import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { generateCommandTable, commandTableSource } from "./command-axes.ts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { hostActions, commandTarget } from "../src/pea/product-actions.generated.ts";
import { isWritePreviewKey } from "@pe/agent-contracts/semantic-actions";
import { commandTable } from "../../agent-contracts/src/command-axes.ts";

test("native effect changes flow through generation into browser metadata", () => {
  const source = [...hostOpCatalog, ...tsOnlyOperationCatalog];
  const changed = source.map((op) =>
    op.key === "ducts.assign-fan" ? { ...op, effect: "SessionWrite" as const } : op,
  );
  const definitions = {
    move: { ...hostActions["ducts.apply-assign-fan"], writeBoundary: undefined },
  };
  const before = generateCommandTable(definitions, source);
  const after = generateCommandTable(definitions, changed);
  expect(before.move!.effect).toBe("ModelWrite");
  expect(after.move!.effect).toBe("SessionWrite");
  expect(commandTableSource(before)).not.toBe(commandTableSource(after));
});

test("receipt controls select their existing transport and SessionWrite scope", () => {
  const table = generateCommandTable();
  for (const key of ["action.cancel"]) {
    expect(table[key]!.effect).toBe("SessionWrite");
    expect(table[key]!.axes.effect).toBe("SessionWrite");
    expect(table[key]!.via).toEqual({ route: key });
  }
  expect(table["action.read"]!.via).toEqual({ route: "actions.read" });
});

test("findings write doors use WorkWrite and plans preserve their native read scope", () => {
  const table = generateCommandTable();
  const writes = Object.entries(hostActions).filter(
    ([key, action]) =>
      key.startsWith("findings.") &&
      "catalogEffect" in action &&
      action.catalogEffect === "WorkWrite",
  );
  expect(writes.length).toBeGreaterThan(0);
  for (const [key] of writes) expect(table[key]!.effect).toBe("WorkWrite");
  expect(table["sheet.apply"]!.plan).toBe("sheet.plan");
  expect(table["sheet.plan"]!.effect).toBe("Read");
});

test("findings.list is Read because listing writes no Work", () => {
  expect(generateCommandTable()["findings.list"]!.effect).toBe("Read");
});

test("a local effect comes from its definition rather than the command name", () => {
  const definition = { ...hostActions["findings.list"], catalogEffect: "WorkWrite" as const };
  expect(generateCommandTable({ "arbitrary.name": definition }, [])["arbitrary.name"]!.effect).toBe(
    "WorkWrite",
  );
  expect(() =>
    generateCommandTable(
      {
        unclassified: {
          says: "No declared effect",
          input: hostActions["findings.list"].input,
          needs: "nothing",
          effect: "query",
          dirties: [],
        },
      },
      [],
    ),
  ).toThrow("declare catalogEffect or native dependencies");
});

test("tracked browser table is fresh and contains data alone", () => {
  const generated = readFileSync(
    new URL("../../agent-contracts/src/generated/command-axes.generated.ts", import.meta.url),
    "utf8",
  );
  expect(generated.replace(/\r\n/g, "\n")).toBe(commandTableSource());
  expect(generated).not.toMatch(/^import\s|Zod|zod|safeParse/m);
});

test("every live write plan is recognised by the browser and no retired plan is retained", () => {
  const live = generateCommandTable();
  const keys = new Set([...Object.keys(live), ...Object.keys(commandTable)]);
  const plans = new Set(Object.values(live).flatMap(({ plan }) => (plan ? [plan] : [])));
  for (const key of keys) expect(isWritePreviewKey(key), key).toBe(plans.has(key));
});

test("Takeoffs native model writes have a generated plan and the existing write boundary", () => {
  const table = generateCommandTable();
  for (const key of ["takeoffs.initialize", "takeoffs.sync"] as const) {
    expect(table[key]).toMatchObject({ effect: "ModelWrite", plan: key + ".preview" });
    expect(hostActions[key].writeBoundary).toMatchObject({
      phase: "apply",
      previewKey: key + ".preview",
    });
  }
});

test("direct handles select targets and bind Work from the same command declaration", () => {
  for (const key of ["page.bind", "ops.read", "action.cancel"])
    expect(commandTarget(key, {})).toEqual({ kind: "host" });
  const ref = { session: "s", openId: "o" };
  const work = {
    key: { binding: "host", route: "parameter-links", target: null },
    revision: 9,
  } as const;
  const bound = hostActions["parameter-links.read"].work.bind({ evaluate: false }, work);
  expect(hostActions["parameter-links.read"].input.parse(bound)).toEqual(bound);
  expect(commandTarget("parameter-links.read", bound, ref)).toEqual({ kind: "document", ref });
});
