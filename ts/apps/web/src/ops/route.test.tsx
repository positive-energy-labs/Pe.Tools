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
        { ...op, key: "document.temporary.status", displayName: "Native status", needs: "session" },
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
  expect(view.queryByRole("textbox", { name: "values" })).toBeNull();
  expect(view.getByRole("link", { name: "instances.stop" })).toBeTruthy();
});

test("native reads use the selected session and never admit a mutation", async () => {
  const { owner } = await mounted();
  act(() => owner().view.setPage({ op: "document.temporary.status" }));
  await waitFor(() => expect(owner().control("run").refusal).toBeNull());
  await act(async () => {
    await owner().control("run").run();
  });
  expect(owner().results.get("run")?.state).toBe("done");
  const [, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(new Headers(init?.headers).get("x-pe-bridge-session-id")).toBe("session-a");
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([url]) => !(url instanceof Request ? url.url : url.toString()).includes("/actions"),
      ),
  ).toBe(true);
});
test.each([
  { loseAck: false, state: "succeeded" },
  { loseAck: true, state: "succeeded" },
  { loseAck: false, state: "failed" },
  { loseAck: true, state: "unknown" },
])(
  "raw mutations retain their receipt after $state and acknowledgement loss=$loseAck",
  async ({ loseAck, state }) => {
    const { view, owner } = await mounted("/ops?target=session-a&op=logs.tail&actionId=original");
    fireEvent.click(await view.findByRole("button", { name: "recover native receipt" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("/actions/recover");
    await waitFor(() => expect(owner().busy()).toBeNull());
    let admitted: unknown;
    let posts = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (
        init?.method === "POST" &&
        (url instanceof Request ? url.url : url.toString()).endsWith("/actions")
      ) {
        posts++;
        const admission = JSON.parse(init.body as string);
        admitted = {
          ...receipt,
          ...admission,
          state,
          ...(state === "succeeded" && {
            status: undefined,
            error: undefined,
            result: { saved: true },
          }),
        };
        if (loseAck) throw Error("lost response after admission");
        return Response.json(admitted);
      }
      if ((url instanceof Request ? url.url : url.toString()).includes("/actions"))
        return Response.json(admitted ? [admitted] : []);
      throw Error(`Unexpected fetch ${url instanceof Request ? url.url : url.toString()}`);
    });
    act(() => owner().view.setPage({ op: "settings.save" }));
    await waitFor(() => expect(owner().control("run").refusal).toBeNull());
    await act(async () => {
      await owner().control("run").run();
    });
    expect(owner().reviews.has("run")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(owner().reviews.get("run")!.ticket.evidence).toMatchObject({
      key: "settings.save",
      input: {},
      target: { kind: "session", session: "session-a" },
    });
    const press = owner().reviews.get("run")!.ticket.press;
    await act(async () => {
      await owner().control("run").run();
    });
    await waitFor(() => expect(owner().view.read().page.actionId).toBe(press));
    const post = vi
      .mocked(fetch)
      .mock.calls.find(
        ([, init]) =>
          init?.method === "POST" && typeof init.body === "string" && init.body.includes(press),
      );
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({
      id: press,
      key: "settings.save",
      target: { kind: "session", session: "session-a" },
      input: {},
    });
    expect(posts).toBe(1);
    expect(owner().results.get("run")?.state).toBe(state === "succeeded" ? "done" : "failed");
  },
);
