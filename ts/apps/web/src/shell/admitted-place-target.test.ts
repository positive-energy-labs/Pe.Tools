import { expect, test, vi } from "vite-plus/test";
import type { DocumentRequest, ExecutionTarget, TargetInventory } from "@pe/agent-contracts";
import { createPlaceTarget } from "./admitted-place-target";

const request = (openId: string): DocumentRequest => ({
  kind: "open",
  ref: { session: "s", openId },
});
const target = (openId: string): ExecutionTarget => ({
  kind: "document",
  ref: { session: "s", openId },
});
const inventory = (...ids: string[]): TargetInventory => ({
  kind: "ready",
  sessions: {
    s: { kind: "ready", values: ids.map((openId) => ({ openId, address: null, kind: "project" })) },
  },
});
function fixture() {
  let active = true;
  const pick = vi.fn();
  const reconnect = vi.fn();
  const owner = createPlaceTarget({ needs: "document", current: () => active, pick, reconnect });
  return {
    owner,
    pick,
    reconnect,
    hide: () => {
      active = false;
    },
  };
}

test("sole target resolves, ambiguity exposes the picker, explicit choice uses existing resolver", () => {
  const f = fixture();
  f.owner.update(inventory("one"));
  expect(f.owner.project(null).writableTarget).toEqual(target("one"));
  const ambiguous = fixture();
  ambiguous.owner.update(inventory("one", "two"));
  expect(ambiguous.owner.project(null)).toMatchObject({
    resolution: { kind: "choose", reason: "several-targets" },
    writableTarget: null,
    picker: [request("one"), request("two")],
  });
  expect(ambiguous.owner.pick(request("two"))).toBe(true);
  expect(ambiguous.pick).toHaveBeenCalledWith(request("two"));
  expect(ambiguous.owner.pick(request("closed"))).toBe(false);
});

test("closed Work stays readable and never gains authority from a reopened document", () => {
  const f = fixture();
  const value = Object.freeze({ amount: 10 });
  const retained = { target: target("old"), value };
  f.owner.update(inventory("old"));
  expect(f.owner.project(retained).writableTarget).toEqual(target("old"));
  f.owner.update(inventory());
  expect(f.owner.project(retained)).toMatchObject({
    resolution: { kind: "choose", reason: "document-closed" },
    identity: target("old"),
    writableTarget: null,
  });
  expect(f.owner.project(retained).retained).toBe(value);
  f.owner.update(inventory("reopened"));
  expect(f.owner.project(retained).writableTarget).toBeNull();
  f.owner.update(inventory("reopened"), request("reopened"));
  expect(f.owner.project(retained).writableTarget).toBeNull();
  expect(f.owner.project(null).writableTarget).toEqual(target("reopened"));
});

test.each<TargetInventory>([
  { kind: "checking" },
  { kind: "failed", message: "offline" },
  { kind: "ready", sessions: { s: { kind: "checking" } } },
])("inventory gap retains identity/value and offers reconnect: %j", (gap) => {
  const f = fixture();
  const retained = { target: target("one"), value: { amount: 2 } };
  f.owner.update(inventory("one"));
  f.owner.update(gap);
  expect(f.owner.project(retained)).toMatchObject({
    identity: target("one"),
    writableTarget: null,
    reconnect: true,
  });
  expect(f.owner.project(retained).retained).toBe(retained.value);
  expect(f.owner.reconnect()).toBe(true);
  expect(f.reconnect).toHaveBeenCalledTimes(1);
  f.owner.update(inventory("one"));
  expect(f.owner.project(retained).writableTarget).toEqual(target("one"));
});

test("inactive picker/reconnect callbacks cannot mutate the active target", () => {
  const f = fixture();
  f.owner.update(inventory("one"));
  f.hide();
  expect(f.owner.pick(request("one"))).toBe(false);
  expect(f.owner.reconnect()).toBe(false);
  expect(f.owner.project(null).writableTarget).toBeNull();
  expect(f.pick).not.toHaveBeenCalled();
  expect(f.reconnect).not.toHaveBeenCalled();
});
