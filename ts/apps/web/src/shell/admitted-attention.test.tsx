// @vitest-environment jsdom
import { placeInput, AdmittedPane } from "./admitted-place.test-fixture";
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { agentFields, fansDocumentSchema } from "@pe/agent-contracts";
import { builtinRouteStamp, loadBuiltinRoute } from "../route/builtin-inventory";
import { createRouteShell } from "./admitted-mount";
import { createFixtureWorkDoor } from "./fixture-work-door";
import { createAttention } from "./admitted-attention";
import type { AdmittedAddressPort } from "./admitted-address";

const call = vi.hoisted(() =>
  vi.fn(async (door: unknown, ..._: unknown[]) => (door === "view.publish" ? { revision: 1 } : {})),
);
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));
const events = vi.hoisted(() => ({ receive: (_event: unknown) => {} }));
vi.mock("#/readings", async (original) => ({
  ...await original<typeof import("#/readings")>(),
  useHostEvents: (_enabled: boolean, receive: (event: unknown) => void) => { events.receive = receive; },
}));
afterEach(() => {
  cleanup();
  call.mockClear();
});

const port = (): AdmittedAddressPort => ({ read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} });
async function fans() {
  const loaded = await loadBuiltinRoute("fans", builtinRouteStamp("fans"));
  if (!loaded.ok) throw Error(JSON.stringify(loaded));
  const shell = createRouteShell({
    work: createFixtureWorkDoor(
      { route: "fans", title: "", description: "", schema: fansDocumentSchema },
      fansDocumentSchema.parse({}),
    ),
    reads: {
      lifetime: "read",
      acquire: (request) => ({
        lifetime: "read",
        key: request.key,
        read: () => ({ status: "pending", current: false, reason: "unused" }),
        release() {},
      }),
    },
    readings: { lifetime: "subscription", subscribe: () => () => {} },
    clock: { lifetime: "read", now: Date.now },
    availability: {},
  });
  return { route: loaded.route, shell };
}

test("admitted /fans attention writes and reads with the admission's own codecs", async () => {
  const { route, shell } = await fans();
  const mount = shell.mount(route, placeInput(port()));
  try {
    const attention = mount.attention!;
    const page = mount.page.read() as Record<string, unknown>;
    const written = attention.write(page);
    expect(Object.keys(written).sort()).toEqual(agentFields(route.data.fields).map(([k]) => k).sort());
    // The object-valued fan field crosses as admitted codec text, the X04 attempt's legacy TypeError.
    expect(attention.read({ fan: written.fan! })).toEqual({ fan: page.fan });
    expect(() => attention.read({ notAField: "x" })).toThrow("not an attention field");
    // Pea's move is a pea-origin owner move; the owner settles it.
    expect(mount.peaMove({ stage: "sheet" })).toMatchObject({ kind: "accepted" });
  } finally {
    mount.close();
  }
});

test("admitted /fans publishes attention; a route without an agent field publishes none", async () => {
  window.history.replaceState(null, "", "/fans?thread=T");
  const { route, shell } = await fans();
  render(createElement(AdmittedPane, { shell, route, address: port() }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "view.publish",
      expect.objectContaining({
        params: { route: "fans" },
        body: expect.objectContaining({ route: "fans", thread: "T", page: expect.any(Object) }),
      }),
    ),
  );
  const body = (call.mock.calls.find(([door]) => door === "view.publish")![1] as { body: { page: Record<string, string> } }).body;
  expect(Object.keys(body.page).sort()).toEqual(agentFields(route.data.fields).map(([k]) => k).sort());
  // Opt-out: every field agent "none" yields no attention, so nothing mounts or publishes.
  expect(createAttention({ a: { role: "pose", agent: "none", codec: "x" } } as never, {} as never)).toBeNull();
});

test("an admitted attention intent reaches its owner and acknowledges the rendered move", async () => {
  window.history.replaceState(null, "", "/fans?thread=T");
  const { route, shell } = await fans();
  const address = port();
  const writes = vi.spyOn(address, "write");
  render(createElement(AdmittedPane, { shell, route, address }));
  await waitFor(() => expect(call.mock.calls.some(([door]) => door === "view.publish")).toBe(true));
  const published = call.mock.calls.find(([door]) => door === "view.publish")![1] as {
    body: { instance: string; page: Record<string, string> };
  };
  const fan = JSON.stringify({ kind: "all" });
  await act(async () => events.receive({
    type: "route-view-intent", route: "fans", thread: "T", instance: published.body.instance,
    revision: 1, commandId: crypto.randomUUID(), patch: { fan },
  }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("view.ack", expect.objectContaining({
    body: expect.objectContaining({ outcome: "rendered", page: expect.objectContaining({ fan }) }),
  })));
  expect(writes.mock.calls.some(([, mode]) => mode === "push")).toBe(true);
});
