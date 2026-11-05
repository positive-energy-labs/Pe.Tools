import { afterEach, expect, test, vi } from "vite-plus/test";
import type {
  WorkPatch,
  BodyBindings,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door.ts";
import { fansData, schemas, entries } from "./neutral.ts";
import { schemas as ductsSchemas } from "../ducts/neutral.ts";
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

// These assignments are compiled by the web/host gate, without executing a write.
function readOnly(
  ctx: Parameters<BodyBindings<typeof fansData, typeof schemas, typeof entries>["price"]["run"]>[0],
) {
  if (!ctx.readings.ductsWork.current) return;
  // @ts-expect-error A cross-route Work reading is immutable, with no mutation capability.
  ctx.readings.ductsWork.value.rules = {};
  // @ts-expect-error Fans patches cannot name a Ducts-owned root.
  const fans: WorkPatch<typeof schemas.work> = { path: ["rules"], value: {} };
  // @ts-expect-error Ducts patches cannot name a Fans-owned root.
  const ducts: WorkPatch<typeof ductsSchemas.work> = { path: ["flows"], value: {} };
  return [fans, ducts];
}
void readOnly;

test("the host refuses cross-route patches and the declared Work reading observes the real owner", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("ductsWork").snapshot.current).toBe(true));
  f.fans.refresh("pricing");
  expect(f.fans.readingStatus("pricing").snapshot.current).toBe(true);
  const fanCalls = () => [...f.calls].filter(([key]) => key.startsWith("fans:"));
  const calls = fanCalls();
  expect(calls.length).toBeGreaterThan(0);
  const before = f.fans.readingStatus("ductsWork").snapshot;
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
  const admission = { routeKey: "fans", fingerprint: f.admitted.presenter.workFingerprint, reading: "ductsWork" };
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
    expect(f.fans.readingStatus("ductsWork").snapshot).toMatchObject({
      current: true,
      value: { rules: { elbow: { edit: { value: { table: "CD3-1" } } } } },
    }),
  );
  const after = f.fans.readingStatus("ductsWork").snapshot;
  expect(after.current && before.current && after.hash !== before.hash).toBe(true);
  expect(f.fans.work()?.revision).toBe(0);
  // Only readings declaring ductsWork (sheet, and sheetSnapshot through it) re-read; nothing else.
  const reread = new Set(["fans:ducts.sheet", "fans:ducts.sheet-snapshot"]);
  expect(fanCalls()).toEqual(calls.map(([key, n]) => [key, reread.has(key) ? n + 1 : n]));
  expect(f.fans.readingStatus("pricing").snapshot.current).toBe(false);
  f.fans.refresh("pricing");
  expect(f.fans.readingStatus("pricing").snapshot).toMatchObject({
    current: true,
    value: { priced: { edit: { rules: { elbow: { table: "CD3-1" } } } } },
  });
});
