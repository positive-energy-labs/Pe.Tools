import { expect, test } from "vite-plus/test";
import { module as fans } from "./route.ts";
import { fansLink } from "./route.ts";
import { localSubject } from "../ducts/identity.ts";
import { selectedFans, stableFanKey } from "../ducts/sheet/model.ts";
import sheet from "../ducts/sheet/sheet.fixture.json";

test("fan links carry the destination identity and binding without ducts Page fields", () => {
  const row = sheet.roster.rows[0];
  if (!row) throw Error("The captured roster has no fan");
  const url = new URL(fansLink([stableFanKey(row)], { fixture: "scene", target: "document", thread: "t", system: "SA", selected: "duct" }), "https://fixture.invalid");
  expect(url.pathname).toBe("/fans");
  expect([...url.searchParams.keys()].sort()).toEqual(["fan", "fixture", "target", "thread"]);
  const subject = JSON.parse(url.searchParams.get("fan") ?? "null");
  expect(fans.spec.fields.fan.schema.parse(subject)).toEqual(subject);
  expect(selectedFans(subject.ids.map(localSubject), sheet.roster.rows)).toEqual([row]);
});
