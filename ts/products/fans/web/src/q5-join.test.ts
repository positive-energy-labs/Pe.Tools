import { beforeAll, expect, test } from "vite-plus/test";
import { applyPatches } from "../../../../packages/agent-contracts/src/route-doc.ts";
import { ductsRouteState } from "@pe/duct-systems-contract/ducts";
import { fansRouteState } from "@pe/fans-contract/fans";
import { editPatches } from "@pe/fans-domain/calc/index";
import { DUCTS_FIXES } from "./calc/closer.ts";

/*
 * Owner ruling Q5: accept a join "ideally on fans, but if its convoluted then ... a is ok". This is
 * the witness for the cut. A join ruling is a patch on `assumptions`, a Ducts Work segment, and a
 * patch issued from the fans route cannot land there: the route's edit door refuses the edit, it
 * names no /ducts owner, and Fans Work has no such segment. So the join stays a link to /ducts
 * (`fans/mount.tsx` `linkTo`, drawn in `ledger-fix.journey.test.tsx`).
 */
let edits: NonNullable<(typeof import("../route.ts"))["module"]["spec"]["edits"]>;
beforeAll(async () => {
  edits = (await import("../route.ts")).module.spec.edits!;
}, 60_000);

test("Q5: a join patch issued from the fans route does not land in Ducts Work", () => {
  const joins = [{ pair: ["1:1", "2:1"] as [string, string], verdict: "accept" as const }];
  const patches = editPatches({ joins });
  expect(patches).toEqual([
    {
      path: ["assumptions", "join:1:1|2:1", "edit"],
      value: { value: { kind: "verdict", verdict: "connect" } },
    },
  ]);
  // The same patch lands in Ducts Work, so the path is typed end to end on /ducts.
  const envelope = <D>(doc: D) => ({ version: 1 as const, revision: 0, doc });
  expect(
    applyPatches(ductsRouteState, envelope(ductsRouteState.schema.parse({})), "human", patches, 0),
  ).toMatchObject({ ok: true });
  // From /fans it has three doors, and each is shut.
  expect(edits.input.safeParse({ joins }).success).toBe(false);
  expect(Object.keys(edits.owners)).not.toContain("duct-systems");
  expect(edits.work).toBe(fansRouteState);
  expect(
    applyPatches(fansRouteState, envelope(fansRouteState.schema.parse({})), "human", patches, 0),
  ).toMatchObject({ ok: false });
  // So the closer's join action is one of /ducts' fixes, which /fans draws as a link.
  expect(DUCTS_FIXES.has("rule")).toBe(true);
});
