import { elementSubject } from "@pe/ducts-domain/work-subject";
import { snapshot as workSnapshot } from "../ducts/test-fixture";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type {} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door.ts";
import { createWitness } from "./cutover.test-support.ts";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
const settle = (write: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    write.subscribe(
      (outcome) => {
        if (outcome.kind !== "pending") resolve(outcome);
      },
      () => {},
    ),
  );

// /fans owns no /ducts Work (ruling 2026-11-10): it cannot even admit a /ducts feed, and reads the
// /ducts design only through its own core read, which the host republishes on a /ducts edit.
test("the host refuses cross-route patches, /fans admits no /ducts feed, and reads /ducts through its core read", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const fanCalls = () => [...f.calls].filter(([key]) => key.startsWith("fans:"));
  const calls = fanCalls();
  expect(calls.length).toBeGreaterThan(0);
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  const badFan = await f.ws.apply(
    key,
    "fans",
    "human",
    [{ path: ["rules", "foreign"], value: {} }],
    0,
  );
  expect(badFan.ok).toBe(false);
  const ductKey = f.owner.workBasis()!.token.scope.identity.work!;
  const admission = {
    routeKey: "fans",
    fingerprint: f.admitted.presenter.workFingerprint,
  };
  expect(await f.ws.admitFeed(ductKey, admission)).toMatchObject({ code: "WorkRouteMismatch" });
  expect(await f.ws.admitFeed({...ductKey,route:"rooms"}, admission)).toMatchObject({
    code: "WorkRouteMismatch",
  });
  expect(
    await f.ws.admitFeed(ductKey, { ...admission, fingerprint: f.admitted.owner.workFingerprint }),
  ).toMatchObject({ kind: "registration-mismatch" });
  const badDuct = await f.ws.apply(
    ductKey,
    "ducts",
    "human",
    [{ path: ["flows", elementSubject(workSnapshot.nodes.find(node => node.id === 4)!)], value: {} }],
    0,
  );
  expect(badDuct.ok).toBe(false);
  expect(
    await settle(
      f.owner.invoke("edit", {
        patches: [{ path: ["rules", "elbow"], value: { edit: { value: { table: "CD3-1" } } } }],
      }) as Observation<WorkWriteOutcome>,
    ),
  ).toMatchObject({ kind: "accepted" });
  expect(f.fans.work()?.revision).toBe(0);
  // The host provider republishes the sheet; the browser does not reacquire its ingredients.
  expect(fanCalls()).toEqual(calls);
  await vi.waitFor(() =>
    expect(f.fans.readingStatus("value").snapshot).toMatchObject({
      current: true,
      value: {
        value: {
          data: {
            ductsWork: {
              rules: { elbow: { edit: { value: { table: "CD3-1" } } } },
            },
          },
        },
      },
    }),
  );
});
