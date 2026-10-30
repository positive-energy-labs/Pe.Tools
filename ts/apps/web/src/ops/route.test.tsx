// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, actionStatusSchema, readingKey } from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { peReadings } from "#/readings";
import { Route as root } from "../routes/__root";
import type { ReadingSource } from "#/shell/readings";
import { opsAdapters, opsRoute } from "./route";
import { RAW_MUTATION_GAP } from "./run";
vi.mock("../routes/__root", async () => ({
  Route: (await import("@tanstack/react-router")).createRootRoute(),
}));
const sources = opsAdapters.sources;
const op = {
  key: "logs.tail",
  displayName: "Tail logs",
  intent: "Read",
  needs: "nothing",
  requestSchemaJson: '{"type":"object","properties":{}}',
};
const receipt = actionReceiptSchema.parse({
  id: "original",
  key: "instances.stop",
  caller: { kind: "human", via: "local" },
  target: { kind: "host" },
  input: {},
  basis: null,
  steps: [],
  prepared: { state: "unprepared" },
  recovery: [],
  startedAt: "2026-10-30T00:00:00.000Z",
  state: "unknown",
  status: 500,
  error: "Recover this action",
});
const fixed = (value: unknown): ReadingSource => ({
  kind: "use",
  open: (_, deliver) => deliver({ kind: "complete", value, revision: 1 }),
});
const releases: (() => void)[] = [];
beforeEach(() => {
  opsAdapters.sources = {
    "ops.catalog": fixed({
      operations: [
        op,
        { ...op, key: "settings.save", displayName: "Raw mutation", intent: "Mutate" },
      ],
    }),
    "ops.receipts": fixed([actionStatusSchema.parse(receipt)]),
    "ops.receipt": fixed([receipt]),
  };
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "machine") {
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: machineFixture([
          {
            session: "session-a",
            documents: [
              {
                openId: "doc-a",
                title: "Model",
                address: null,
                isFamilyDocument: false,
                isActive: true,
              },
            ],
          },
        ]),
      });
      return () => {};
    }
    if (request.kind !== "inventory") throw Error(`Unexpected reading ${request.kind}`);
    accept({
      kind: "snapshot",
      key: readingKey(request),
      value: {
        sessions: [
          {
            sessionId: "session-a",
            connected: true,
            openDocumentCount: 1,
            openDocuments: [{ openId: "doc-a", title: "Model", isFamilyDocument: false }],
          },
        ],
      },
    });
    return () => {};
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/call")
        ? Response.json({ lines: ["fixture-result"] })
        : url.includes("/actions/recover")
          ? Response.json(receipt)
          : Promise.reject(Error(`Unexpected fetch ${url} ${init?.method}`)),
    ),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
});
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  opsAdapters.sources = sources;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete opsAdapters.wrap;
});
async function mounted(url = "/ops?target=session-a&op=logs.tail") {
  // A context provider captures the real mount without replacing its owner or Target door.
  opsAdapters.wrap = (_owner, children) => children;
  const wrap = vi.spyOn(opsAdapters, "wrap");
  const router = createRouter({
    routeTree: root.addChildren([opsRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  releases.push(router.history.subscribe(router.load));
  await router.load();
  const Component = opsRoute.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await view.findByText("Tail logs", { selector: "h1" });
  return { view, router, owner: () => wrap.mock.calls.at(-1)![0] };
}
test("the real graph restores the operation URL, runs a read and lands its output in Page and History", async () => {
  const { view, owner, router } = await mounted();
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Run" }).getAttribute("aria-disabled")).not.toBe(
      "true",
    ),
  );
  fireEvent.click(view.getByRole("button", { name: "Run" }));
  await waitFor(() =>
    expect(owner().view.read().page.result).toMatchObject({
      op: "logs.tail",
      value: { lines: ["fixture-result"] },
    }),
  );
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
    key: "logs.tail",
    request: {},
  });
  expect(
    owner()
      .timeline.read()
      .some((entry) => entry.kind === "receipt"),
  ).toBe(true);
  expect(router.state.location.search.op).toBe("logs.tail");
  expect(router.state.location.search).not.toHaveProperty("result");
});
test("receipt recovery uses a human RPC and raw mutations refuse before transport", async () => {
  const { view, owner } = await mounted("/ops?target=session-a&op=logs.tail&actionId=original");
  fireEvent.click(await view.findByRole("button", { name: "recover native receipt" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("/actions/recover");
  await waitFor(() => expect(owner().busy()).toBeNull());
  act(() => owner().view.setPage({ op: "settings.save" }));
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Run" }).getAttribute("aria-disabled")).toBe("true"),
  );
  expect(owner().control("run").refusal).toBe(RAW_MUTATION_GAP);
  expect(fetch).toHaveBeenCalledTimes(1);
});
