// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { citation, selection } from "@pe/kit/lang/attention";
import { subjectSchema } from "@pe/agent-contracts/route";
import { subjectCode } from "@pe/agent-contracts/subject-ref";
import type { Readings } from "../host/resource-stream";
import { PointerCite, pointerRefs } from "./pointer-list";
import { makeAtomRegistry } from "./owner";
vi.mock("#/workbench/provider/thread-summary", async () => ({
  WorkbenchContext: (await import("react")).createContext({ currentThreadId: "t1" }),
}));
afterEach(cleanup);
const type = subjectCode({ keyKind: "name", key: ["Fam", "Type"] });
const port = subjectCode({ keyKind: "name", key: ["Fam", "Type"], sub: { port: 1 } });
const fields = { fan: { role: "subject", schema: subjectSchema(512) } };

test("a place uses its declared subject codec; parts cite their base and foreign fields do not resolve", () => {
  expect(
    pointerRefs({ fan: JSON.stringify({ kind: "ids", ids: [port] }) }, fields, "s/o").map(
      (ref) => ref.key,
    ),
  ).toEqual([port, type]);
  expect(pointerRefs({ unknown: "not json" }, fields, "s/o")).toEqual([]);
  expect(() => pointerRefs({ fan: "not json" }, fields, "s/o")).toThrow();
});

test("one thread-head stream frame lights the type without changing selection or URL; dismissal and unmount clear it", async () => {
  let deliver: Parameters<Readings["subscribe"]>[1] = () => {};
  let stopped = false;
  const readings: Pick<Readings, "subscribe"> = {
    subscribe(request, listener) {
      expect(request).toEqual({ kind: "thread-head", thread: "t1" });
      deliver = listener;
      return () => {
        stopped = true;
      };
    },
  };
  const registry = makeAtomRegistry();
  const url = window.location.href,
    selected = registry.get(selection("s/o"));
  const { unmount } = render(
    <RegistryContext value={registry}>
      <PointerCite route="families" fields={fields} doc="s/o" readings={readings} />
    </RegistryContext>,
  );
  await act(async () =>
    deliver({
      kind: "snapshot",
      key: "head",
      value: {
        pointers: [{ id: "p1", route: "families", target: type, label: "Type", at: "now" }],
      },
    }),
  );
  expect(registry.get(citation)).toMatchObject({
    owner: "pointers:families",
    refs: [{ doc: "s/o", key: type }],
  });
  expect(registry.get(selection("s/o"))).toEqual(selected);
  expect(window.location.href).toBe(url);
  await act(async () => deliver({ kind: "snapshot", key: "head", value: { pointers: [] } }));
  expect(registry.get(citation)).toBeNull();
  unmount();
  expect(stopped).toBe(true);
});
