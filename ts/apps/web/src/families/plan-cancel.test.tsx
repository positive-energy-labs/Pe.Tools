// @vitest-environment jsdom
/**
 * F-B-8: plan then cancel on the Chat-hosted /families returns to the stage plan was pressed in:
 * never "Applying", the draft verbs are back, the spec pane's absence lines never drew (F-B-6),
 * and typing into a cell stages it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
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

import { ChatHosted } from "#/route/situation";
import { FamiliesRouteContent } from "#/routes/families";

const REF = { session: "session-hosted", openId: "open-1" };
const STAGED = familyCellKey({
  familyName: "Fan Coil Unit - Ducted",
  typeName: "FCU-1",
  parameter: "PE_G___Model",
});

class WireSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    const keys = JSON.parse(new URL(url).searchParams.get("keys") ?? "[]") as ReadingRequest[];
    for (const request of keys) {
      const value =
        request.kind === "field-options"
          ? { items: [{ value: "Mechanical Equipment" }] }
          : request.kind === "inventory"
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
                      scope: {
                        staged: {
                          value: {
                            categoryNames: ["Mechanical Equipment"],
                            familyNames: [],
                            placementScope: "AllLoaded",
                          },
                        },
                      },
                      cells: {
                        [STAGED]: {
                          proposal: null,
                          staged: { value: { value: "FXMQ20", storageType: "String" } },
                        },
                      },
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
const verbs = () => screen.getAllByRole("button").map((b) => b.childNodes[0]?.textContent ?? "");
const verb = (label: string) =>
  screen.getAllByRole("button").find((b) => b.childNodes[0]?.textContent === label)!;

test("plan then cancel: not Applying, save draft to pod is back, a typed cell stages", async () => {
  const writes: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    writes.push(await new Request("http://host.test", init).json());
    return new Response(JSON.stringify({ ok: true, revision: 4 }));
  });
  client.runSemanticAction.mockResolvedValue({
    state: "succeeded",
    result: {
      id: "plan-1",
      plan: {
        familyId: 3101,
        familyName: "Fan Coil Unit - Ducted",
        planHash: "ph",
        changes: [],
        runEffects: ["x"],
        refusals: [],
        warnings: [],
      },
    },
  });
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <ChatHosted.Provider value>
          <FamiliesRouteContent thread="T" />
        </ChatHosted.Provider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/chat?thread=T&plugin=families"] }),
  });
  await router.load();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(verbs()).toContain("save draft to pod"), { timeout: 5_000 });
  await act(async () =>
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "choose a pod")!),
  );
  await act(async () => fireEvent.click(await screen.findByText("P")));
  await act(async () => fireEvent.click(verb("plan")));
  const sheet = await screen.findByRole("region", { name: "Confirmation sheet" });
  // F-B-6: an open sheet draws no spec absence lines.
  expect(document.body.textContent).not.toMatch(
    /choose a family spec|capture a spec, or pick a member/,
  );
  await act(async () =>
    fireEvent.click([...sheet.querySelectorAll("button")].find((b) => b.textContent === "cancel")!),
  );

  expect(screen.queryByRole("region", { name: "Confirmation sheet" })).toBeNull();
  expect(verbs()).not.toContain("Applying");
  expect(verbs()).toContain("save draft to pod");
  const cell = await waitFor(() => {
    const input = [
      ...view.container.querySelectorAll<HTMLInputElement>("input.dl-cell-input"),
    ].find((el) => el.defaultValue === "RXL24");
    expect(input).toBeTruthy();
    return input!;
  });
  await act(async () => cell.focus());
  fireEvent.change(cell, { target: { value: "RXL30" } });
  await act(async () => fireEvent.keyDown(cell, { key: "Enter" }));
  await waitFor(() => expect(JSON.stringify(writes)).toContain("RXL30"));
}, 30_000);
