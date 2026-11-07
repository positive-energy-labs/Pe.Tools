import { afterEach, expect, test, vi } from "vite-plus/test";
import type {

} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
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

test("the host refuses cross-route patches and the declared Work reading observes the real owner", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("owner:ducts").snapshot.current).toBe(true));
  const fanCalls = () => [...f.calls].filter(([key]) => key.startsWith("fans:"));
  const calls = fanCalls();
  expect(calls.length).toBeGreaterThan(0);
  const before = f.fans.readingStatus("owner:ducts").snapshot;
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
  const admission = { routeKey: "fans", fingerprint: f.admitted.presenter.workFingerprint, reading: "owner:ducts" };
  expect(await f.ws.admitFeed(ductKey, admission)).toBeNull();
  expect(await f.ws.admitFeed(ductKey, { ...admission, reading: "not-declared" })).toMatchObject({ code: "WorkRouteMismatch" });
  expect(await f.ws.admitFeed(ductKey, { ...admission, fingerprint: f.admitted.owner.workFingerprint })).toMatchObject({ kind: "registration-mismatch" });
  const badDuct = await f.ws.apply(
    ductKey,
    "ducts",
    "human",
    [{ path: ["flows", "4"], value: {} }],
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
  await vi.waitFor(() =>
    expect(f.fans.readingStatus("owner:ducts").snapshot).toMatchObject({
      current: true,
      value: { rules: { elbow: { edit: { value: { table: "CD3-1" } } } } },
    }),
  );
  const after = f.fans.readingStatus("owner:ducts").snapshot;
  expect(after.current && before.current && after.hash !== before.hash).toBe(true);
  expect(f.fans.work()?.revision).toBe(0);
  // The host provider republishes the sheet; the browser does not reacquire its ingredients.
  expect(fanCalls()).toEqual(calls);
  await vi.waitFor(() => expect(f.fans.readingStatus("value").snapshot).toMatchObject({
    current: true, value: { value: { data: { ductsWork: {
      rules: { elbow: { edit: { value: { table: "CD3-1" } } } },
    } } } },
  }));
});
