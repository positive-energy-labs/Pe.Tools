// @vitest-environment jsdom
import { Activity, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { contentHash, createReadingGraph, type ReadingDelivery } from "./readings";

afterEach(cleanup);

test("revealing a retained app tab does not reacquire unchanged readings", async () => {
  const attempts: ReadingDelivery[] = [];
  const close = vi.fn();
  const value = { context: "retained model" };
  const graph = createReadingGraph(
    { readings: { model: { kind: "use", source: "model", retire: "target" } } },
    {
      scope: {
        target: { kind: "document", ref: { session: "fixture", openId: "fixture-doc" } },
        workKey: null,
        workRevision: null,
        work: null,
        page: {},
      },
      sources: {
        model: {
          kind: "use",
          open: (_context, deliver) => {
            attempts.push(deliver);
            return close;
          },
        },
      },
      log: () => {},
    },
  );
  function Pane() {
    // The same acquisition boundary as MountedPane in shell/mount.tsx.
    useEffect(() => graph.mount(["model"]), []);
    return null;
  }
  const tree = (hidden: boolean) => (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <Pane />
    </Activity>
  );
  const view = render(tree(false));
  try {
    act(() => attempts[0]!({ kind: "complete", value, revision: 1 }));
    expect(graph.get("model")).toMatchObject({ status: "ready", value });
    view.rerender(tree(true));
    view.rerender(tree(false));
    await act(async () => {});
    expect({ attempts: attempts.length, status: graph.get("model").status }).toEqual({
      attempts: 1,
      status: "ready",
    });
  } finally {
    view.unmount();
    graph.dispose();
  }
});

test("published values carry a content hash: equal content, equal hash; sourceVersion wins", () => {
  expect(contentHash({ a: 1, b: [2] })).toBe(contentHash({ b: [2], a: 1 }));
  expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  let deliver!: ReadingDelivery;
  const graph = createReadingGraph(
    { readings: { model: { kind: "use", source: "model", retire: "target" } } },
    {
      scope: {
        target: { kind: "document", ref: { session: "s", openId: "d" } },
        workKey: null,
        workRevision: null,
        work: null,
        page: {},
      },
      sources: { model: { kind: "use", open: (_c, d) => void (deliver = d) } },
      log: () => {},
    },
  );
  const release = graph.mount(["model"]);
  deliver({ kind: "complete", value: { a: 1 }, revision: 1 });
  expect(graph.get("model").hash).toBe(contentHash({ a: 1 }));
  deliver({ kind: "complete", value: { a: 1 }, revision: 2, sourceVersion: "v7" });
  expect(graph.get("model").hash).toBe("v7");
  release();
  graph.dispose();
});
