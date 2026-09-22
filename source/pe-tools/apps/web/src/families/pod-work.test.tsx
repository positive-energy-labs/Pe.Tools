// @vitest-environment jsdom
/**
 * F-B-5b: the pod is a person-owned field of the families Work. Choosing it is one human write,
 * a reload reads it back, plan's source.pod is Work's, and no pod refuses to the Chat head.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { familyCellKey, readingKey, type ReadingRequest } from "@pe/agent-contracts";

vi.mock("#/host/client", async (importOriginal) => {
  const { DEMO_FAMILIES } = await import("#/families/seeds");
  return {
    ...(await importOriginal<typeof import("#/host/client")>()),
    callHostRpc: async (key: string) => {
      if (key === "pod.list") return { pods: [{ id: "p", name: "P", folder: "f", members: [] }] };
      if (key === "revit.catalog.field-options")
        return { items: [{ value: "Mechanical Equipment" }] };
      if (key === "revit.catalog.loaded-families")
        return { families: DEMO_FAMILIES.map((f) => ({ familyName: f.familyName })) };
      if (key === "revit.matrix.loaded-families") return { families: DEMO_FAMILIES, issues: [] };
      throw new Error(`no host in test: ${key}`);
    },
    callHostDynamic: () => Promise.reject(new Error("no host in test")),
  };
});
const client = vi.hoisted(() => ({ runSemanticAction: vi.fn() }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => client);
vi.mock("#/lib/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/lib/token")>()),
  token: () => "currentColor",
}));

import { ChatHosted, ChatPlanIntent } from "#/route/situation";
import { FamiliesRouteContent } from "#/routes/families";

const REF = { session: "session-hosted", openId: "open-1" };
const STAGED = familyCellKey({
  familyName: "Fan Coil Unit - Ducted",
  typeName: "FCU-1",
  parameter: "PE_G___Model",
});

const wire = { pod: "" };

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    for (const request of keys) {
      const value =
        request.kind === "inventory"
          ? {
              sessions: [
                {
                  connected: true,
                  sessionId: REF.session,
                  openDocumentCount: 1,
                  openDocuments: [
                    {
                      openId: REF.openId,
                      title: "MEP",
                      address: "C:\\M.rvt",
                      isFamilyDocument: false,
                    },
                  ],
                },
              ],
            }
          : request.kind === "thread-head"
            ? { defaultTarget: { kind: "open", ref: REF }, revision: 1 }
            : request.kind === "work"
              ? {
                  revision: 3,
                  doc: {
                    ...(wire.pod ? { pod: wire.pod } : {}),
                    scope: {
                      staged: {
                        value: {
                          categoryNames: ["Mechanical Equipment"],
                          familyNames: [],
                          placementScope: "AllLoaded",
                        },
                      },
                    },
                    cells: { [STAGED]: { proposal: null, staged: { value: { value: "FXMQ20" } } } },
                    excluded: {},
                  },
                }
              : undefined;
      if (value !== undefined)
        setTimeout(() => {
          const key = readingKey(request);
          this.onmessage?.({ data: JSON.stringify({ kind: "snapshot", key, value }) });
        }, 0);
    }
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = WireSource;

// A verb's label is its first text; a count may follow it.
const verb = (label: string) =>
  screen.getAllByRole("button").find((b) => b.childNodes[0]?.textContent === label)!;

const mount = async (entry = {}, refused?: (message: string) => void) => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ChatHosted.Provider value>
          <ChatPlanIntent.Provider
            value={refused ? { route: "families", take: () => true, refused } : null}
          >
            <FamiliesRouteContent thread="T" entry={entry} />
          </ChatPlanIntent.Provider>
        </ChatHosted.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/chat?thread=T&plugin=families"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(verb("save draft to pod")).toBeTruthy(), { timeout: 5_000 });
  return view;
};

const writes: string[] = [];
beforeEach(() => {
  wire.pod = "";
  writes.length = 0;
  client.runSemanticAction.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    writes.push(String(init?.body));
    return new Response(JSON.stringify({ ok: true, revision: 4 }));
  });
});
afterEach(cleanup);

test("F-B-5b · the chosen pod is one human write to Work and reads back after a reload", async () => {
  const view = await mount();
  await act(async () =>
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "choose a pod")!),
  );
  await act(async () => fireEvent.click(await screen.findByText("P")));
  await waitFor(() => expect(writes.join()).toMatch(/"path":\["pod"\],"value":"p"/));
  expect(writes.filter((w) => w.includes('"pod"'))).toHaveLength(1);

  // The reload: the host now holds what was written, and the page remembers nothing.
  view.unmount();
  wire.pod = "p";
  await mount();
  await waitFor(() =>
    expect(screen.getAllByRole("button").some((b) => b.textContent === "P")).toBe(true),
  );
}, 30_000);

test("F-B-5b · plan builds source.pod from Work's pod", async () => {
  wire.pod = "p";
  client.runSemanticAction.mockResolvedValue({ state: "succeeded", result: { id: "x", plan: [] } });
  await mount();
  await act(async () => fireEvent.click(verb("plan")));
  const plans = () =>
    client.runSemanticAction.mock.calls.filter((call) => JSON.stringify(call).includes("families.plan"));
  await waitFor(() => expect(plans()).toHaveLength(1));
  console.log("PLANCALL", JSON.stringify(plans()[0]));
  expect(JSON.stringify(plans()[0])).toMatch(/"source":\{"pod":"p"/);
}, 30_000);

test("F-B-5b · with no pod on Work, plan refuses 'choose the pod' to the Chat head", async () => {
  const refused = vi.fn();
  // A page-state pod (an old URL) is not the person's choice; only Work's is.
  await mount({ pod: "p" }, refused);
  await waitFor(() => expect(refused).toHaveBeenCalledWith(expect.stringMatching(/choose the pod/)));
}, 30_000);
