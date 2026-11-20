import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { resourceReadingSchema } from "../src/pea/product-contracts.generated.ts";
import { decodeResourceSubscriptionUpdate } from "@pe/runtime/resource-stream";
import {
  linkedCatalog,
  matchPeRoute,
  peRoutes,
  servePeRoute,
} from "../src/pea/product-catalog.generated.ts";

const catalogEntries = [...linkedCatalog().entries.values()];

test("the product's catalog endpoint keeps its typed gateway contract", async () => {
  const request = new Request("http://host/pe/ducts/catalogs");
  expect(matchPeRoute(request.method, new URL(request.url).pathname)).toMatchObject({
    id: "ducts.catalogs",
    route: { permission: "read", owner: "gateway" },
  });
  expect(
    (await servePeRoute(request, async () => Response.json({ tables: {}, findings: [] }))).status,
  ).toBe(200);
  expect((await servePeRoute(request, async () => Response.json({}))).status).toBe(500);
});

test("product reading requests enter through the assembled stream schema", () => {
  expect(linkedCatalog().entries.get("ducts.snapshot.walk")?.call).toEqual({
    canonicalSession: true,
    reading: "walk",
  });
  const reading = {
    kind: "ducts-snapshot",
    target: { session: "test", openId: "doc" },
    selector: { kind: "roster" },
  };
  const request = JSON.stringify({ add: [reading], remove: [] });
  expect(decodeResourceSubscriptionUpdate(request)).toEqual({ error: "Invalid resource keys" });
  expect(decodeResourceSubscriptionUpdate(request, resourceReadingSchema)).toEqual({
    add: [reading],
    remove: [],
  });
  const bad = JSON.stringify({ add: [{ ...reading, slots: { unsupported: "slot" } }], remove: [] });
  expect(decodeResourceSubscriptionUpdate(bad, resourceReadingSchema)).toEqual({
    error: "Invalid resource keys",
  });
});
test("the shipped write leaves split preview from commit", () => {
  const byKey = new Map(catalogEntries.map((row) => [row.key, row]));
  // ducts.apply plans with no transaction (a Read); the others rehearse and roll back.
  expect(byKey.get("ducts.apply")).toMatchObject({
    effect: "ModelWrite",
    internal: true,
    previewBy: "ducts.apply.plan",
  });
  expect(byKey.get("ducts.apply.plan")).toMatchObject({ effect: "Read", rollsBack: false });
  expect(byKey.get("ducts.apply.preview")).toBeUndefined();
  // Every Ducts plan is a Read and is the apply's only seal authority; a rehearsal rolls back and arms nothing.
  // The losses pair is the sheet pair (slice 7): one plan/apply every sheet shares.
  expect(byKey.get("command:sheet.plan")).toMatchObject({ effect: "Read" });
  expect(byKey.get("command:sheet.apply")).toMatchObject({
    effect: "ModelWrite",
    previewBy: "command:sheet.plan",
  });
  for (const kind of ["heal", "assign-fan"]) {
    expect(byKey.get(`command:ducts.plan-${kind}`)).toMatchObject({ effect: "Read" });
    expect(byKey.get(`command:ducts.apply-${kind}`)).toMatchObject({
      effect: "ModelWrite",
      previewBy: `command:ducts.plan-${kind}`,
    });
    expect(byKey.get(`command:ducts.preview-${kind}`)).toBeUndefined();
  }
  for (const kind of ["heal", "assign-fan"])
    expect(byKey.get(`command:ducts.rehearse-${kind}`)).toMatchObject({
      effect: "TransactRead",
      rollsBack: true,
    });
  for (const key of ["ducts.heal", "ducts.assign-fan", "revit.apply.parameter-links"]) {
    expect(byKey.get(key)).toMatchObject({
      effect: "ModelWrite",
      internal: true,
      previewBy: `${key}.preview`,
    });
    // The effect is the native handler's scope: the parameter-links preview opens no transaction, so it is a Read.
    expect(byKey.get(`${key}.preview`)).toMatchObject(
      key === "revit.apply.parameter-links"
        ? { effect: "Read", rollsBack: false }
        : { effect: "TransactRead", rollsBack: true },
    );
  }
  for (const row of catalogEntries.filter(
    (row) => row.key.startsWith("command:") && row.effect === "ModelWrite",
  ))
    expect(["Read", "TransactRead"]).toContain(byKey.get(row.previewBy!)?.effect);
});

test("named reads cannot fall through the advertised open read arm", () => {
  const input = peRoutes["reads.value"].catalog.discovery!.input as {
    anyOf: { properties: { read: { pattern?: string } } }[];
  };
  const open = input.anyOf.at(-1)!.properties.read.pattern!;
  expect(new RegExp(open).test("fans.roster")).toBe(false);
  expect(new RegExp(open).test("fans.calc-detail")).toBe(false);
  expect(new RegExp(open).test("other.read")).toBe(true);
  const advertised = z.fromJSONSchema(input);
  for (const read of ["fans.roster", "fans.calc-detail"])
    expect(
      advertised.safeParse({
        read,
        args: { proposal: {}, edits: [] },
        subscription: "test",
        generation: 0,
      }).success,
    ).toBe(false);
  expect(
    advertised.safeParse({ read: "other.read", args: {}, subscription: "test", generation: 0 })
      .success,
  ).toBe(true);
});
