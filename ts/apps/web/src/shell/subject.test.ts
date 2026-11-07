import { expect, test } from "vite-plus/test";
import {
  manyField,
  manyCodec,
  resolveMany,
} from "../../../../packages/agent-contracts/src/route-field";
import { openSet } from "./open-set.neutral";

test("picker selection preserves active membership and resolves its removal", () => {
  const set = openSet((id: string) => id, ["a", "b", "c"]);
  const value = { kind: "ids", ids: ["a", "b"], active: "b" } as const;
  expect(set.select(value, ["a", "b", "c"])).toEqual({ ...value, ids: ["a", "b", "c"] });
  expect(set.select(value, ["a", "c"])).toEqual({ kind: "ids", ids: ["a", "c"] });
  expect(set.select({ kind: "all" }, ["a", "b"])).toEqual({ kind: "ids", ids: ["a", "b"] });
  expect(set.select(value, [])).toEqual({ kind: "ids", ids: [] });
});
test("subject many codec preserves exact sets and resolves all against the current roster", () => {
  const ids = ["SA,1", "FC-1@2", "a%b", "all"];
  expect(manyCodec.decode(manyCodec.encode(ids))).toEqual(ids);
  expect(resolveMany("all", ["A", "B"])).toEqual(["A", "B"]);
  expect(() => manyField("ElementId" as never, {})).toThrow(/ElementId/);
});
test("an open set keeps its active member explicit: add never moves it, remove hands it to a neighbour", () => {
  const set = openSet((id: string) => id, ["a", "b", "c", "d"]);
  const empty = { kind: "ids", ids: [] } as const;
  // The first subject into an empty set is active; later adds stay in the background.
  const one = set.add(empty, ["b"]);
  expect(set.active(one)).toBe("b");
  const three = set.add(one, ["c", "a", "c"]);
  expect(three).toEqual({ kind: "ids", ids: ["b", "c", "a"] });
  expect(set.active(three)).toBe("b");
  // setActive pins a member; a URL keeps `active` only when it is not the first.
  const pinned = set.setActive(three, "a");
  expect(pinned).toEqual({ kind: "ids", ids: ["b", "c", "a"], active: "a" });
  expect(set.add(pinned, ["d"])).toEqual({ kind: "ids", ids: ["b", "c", "a", "d"], active: "a" });
  // Removing a background member keeps the active; removing the active falls to the next, else the previous.
  expect(set.remove(pinned, "c")).toEqual({ kind: "ids", ids: ["b", "a"], active: "a" });
  expect(set.active(set.remove(set.setActive(three, "c"), "c"))).toBe("a");
  expect(set.active(set.remove(pinned, "a"))).toBe("c");
  expect(set.remove(set.remove(one, "b"), "b")).toEqual(empty);
  // toggle opens into the background and closes; setActive on a closed subject opens it.
  expect(set.toggle(three, "d")).toEqual({ kind: "ids", ids: ["b", "c", "a", "d"] });
  expect(set.toggle(three, "b")).toEqual({ kind: "ids", ids: ["c", "a"] });
  expect(set.setActive(one, "d")).toEqual({ kind: "ids", ids: ["b", "d"], active: "d" });
  // All: everything is open and the roster's first is active; add never freezes it into ids.
  const all = { kind: "all" } as const;
  expect(set.add(all, ["a"])).toBe(all);
  expect(set.active(all)).toBe("a");
  expect(set.remove(all, "a")).toEqual({ kind: "ids", ids: ["b", "c", "d"] });
  expect(set.remove(all, "c")).toEqual({ kind: "ids", ids: ["a", "b", "d"] });
});

// FANSPLIT Q2: exercise admitted declarations as well as the legacy policy fixture.
test("admitted ducts and fans publish distinct subject nouns and Work bindings", async () => {
  const { admit } = await import("../fans/admission.fixture.ts");
  const { owner, presenter } = await admit();
  expect(owner.data.subject).toMatchObject({ field: "system", noun: "system" });
  expect(presenter.data.subject).toMatchObject({ field: "fan", noun: "fan" });
  expect(owner.typed.spec.edits.work.route).toBe("ducts");
  expect(presenter.typed.spec.edits.work.route).toBe("fans");
});
