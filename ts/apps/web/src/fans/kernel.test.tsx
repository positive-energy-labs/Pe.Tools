import { expect, test } from "vite-plus/test";
import { fansDocumentSchema } from "@pe/agent-contracts";
import { admit } from "./admission.fixture.ts";
import { z } from "zod";
import { builtinClosureFingerprint, createBuiltinRouteInventory } from "../../../../packages/agent-contracts/src/route-module.ts";
import { module as fans } from "./route.ts";
import { fansLink } from "./route.ts";
import { localSubject } from "../ducts/neutral.ts";
import { selectedFans, stableFanKey } from "../ducts/sheet/model.ts";
import sheet from "../ducts/sheet/sheet.fixture.json";

test("fans admits its own schema and fingerprint independently of ducts", async () => {
  const { owner, presenter, hostOwner, hostPresenter } = await admit();
  expect(owner.data.work).toHaveProperty("schema", "work");
  expect(presenter.data.work).toEqual({ route: "fans", schema: "work", version: 1, migrations: {} });
  expect(presenter.workFingerprint).not.toBe(owner.workFingerprint);
  expect(presenter.resolvedWork?.schema.parse({})).toEqual(fansDocumentSchema.parse({}));
  expect(hostPresenter.resolvedWork?.spec.route).toBe("fans");
  expect(hostOwner.resolvedWork?.spec.route).toBe("ducts");
});

test("nominal Work schema boundary refuses unknown keys and mismatched schema objects", async () => {
  for (const unknown of [true, false]) {
    const data = { ...fans.data, work: { ...fans.data.work, schema: unknown ? "missing" : "work" } };
    const original = { ...fans, data };
    const envelope = { source: "builtin-closure" as const, version: 1 as const, data,
      hostVersion: "schema-boundary-test", variants: [{ client: "web" as const, entry: "fixture.ts" }],
      modules: [{ id: "fixture.ts", sha256: "a".repeat(64) }], inputs: [], externals: [] };
    const fingerprint = await builtinClosureFingerprint(envelope);
    const inventory = createBuiltinRouteInventory({ fans: { module: original,
      closure: { envelope, fingerprint }, catalog: Object.entries(fans.entries).map(([key, entry]) => ({ key, ...entry.axes, uses: [] })) } });
    const admission = await inventory.prepare("fans", fingerprint);
    const result = admission.admitUnknown(unknown ? original : { ...original,
      schemas: { ...original.schemas, work: z.object({ unrelated: z.string() }) } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some(diagnostic =>
      /schema|Bindings differ/i.test(diagnostic.message))).toBe(true);
  }
});

test("fan links carry the destination identity and binding without ducts Page fields", () => {
  const row = sheet.roster.rows[0];
  if (!row) throw Error("The captured roster has no fan");
  const url = new URL(fansLink([stableFanKey(row)], { fixture: "scene", target: "document", thread: "t", system: "SA", selected: "duct" }), "https://fixture.invalid");
  expect(url.pathname).toBe("/fans");
  expect([...url.searchParams.keys()].sort()).toEqual(["fan", "fixture", "target", "thread"]);
  const subject = JSON.parse(url.searchParams.get("fan") ?? "null");
  expect(fans.codecs.fan.decode(url.searchParams.get("fan") ?? "")).toEqual({ ok: true, value: subject });
  expect(selectedFans(subject.ids.map(localSubject), sheet.roster.rows)).toEqual([row]);
});
