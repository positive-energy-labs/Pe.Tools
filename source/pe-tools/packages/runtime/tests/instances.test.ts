import { expect, test, vi } from "vite-plus/test";
import { instancesRouteState, address } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { createInstancesCommandHandlers } from "../../mcps/src/pea/instances-commands.ts";

test("Instances isolates workspaces, denies agent lifecycle controls and replays an open once", async () => {
  const data = new Map<string, unknown>();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          result: { state: "ok", activeDocument: { path: "C:\\Models\\A.rvt" } },
          diagnostics: [],
        }),
      ),
  );
  const workspace = new RouteWorkspace({
    registrations: [
      {
        spec: instancesRouteState,
        handlers: createInstancesCommandHandlers({ hostBaseUrl: "http://localhost:9999" }),
      },
    ],
    store: {
      getState: async ({ documentAddress, route }) => data.get(`${documentAddress}/${route}`),
      setState: async ({ documentAddress, route, value }) => {
        data.set(`${documentAddress}/${route}`, structuredClone(value));
      },
    },
  });
  const a = { workspaceId: "chat-a" };
  const b = { workspaceId: "chat-b" };
  try {
    await expect(
      workspace.read({ documentAddress: address("C:\\Models\\A.rvt") }, "instances"),
    ).rejects.toThrow("workspace scope");
    expect(
      await workspace.apply(a, "instances", "agent", [{ path: ["observation"], value: {} }], 0),
    ).toMatchObject({ ok: false });
    expect(
      await workspace.apply(
        a,
        "instances",
        "agent",
        [
          {
            path: ["staged"],
            value: { kind: "open", session: "session:exact", document: "C:\\Models\\A.rvt" },
          },
        ],
        0,
      ),
    ).toMatchObject({ ok: true });
    expect((await workspace.read(b, "instances"))?.doc).toMatchObject({ staged: null });
    for (const command of ["restart", "stop", "close", "recover"]) {
      expect(
        await workspace.command(a, "instances", "agent", command, {}, 1, command),
      ).toMatchObject({ ok: false, kind: "refused" });
    }
    expect(fetch).not.toHaveBeenCalled();
    const first = await workspace.command(a, "instances", "agent", "open", {}, 1, "open-once");
    expect(first.ok).toBe(true);
    expect(await workspace.command(a, "instances", "agent", "open", {}, 1, "open-once")).toEqual(
      first,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      id: "exact",
      path: "C:\\Models\\A.rvt",
    });
    expect((await workspace.read(a, "instances"))?.doc).toMatchObject({
      staged: null,
      outcome: { action: "open" },
    });
    const revision = (await workspace.read(a, "instances"))!.revision;
    await workspace.apply(
      a,
      "instances",
      "agent",
      [{ path: ["staged"], value: { kind: "start", year: "2026", name: "new-session" } }],
      revision,
    );
    fetch.mockImplementation(
      async () => new Response(JSON.stringify({ result: { state: "ready" }, diagnostics: [] })),
    );
    const started = await workspace.command(
      a,
      "instances",
      "agent",
      "start",
      {},
      revision + 1,
      "start-once",
    );
    expect(started.ok).toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual({
      action: "start",
      lane: "installed",
      id: "new-session",
      year: "2026",
    });
    expect((await workspace.read(a, "instances"))?.doc).toMatchObject({
      selectedSession: "session:new-session",
      staged: null,
    });
  } finally {
    fetch.mockRestore();
  }
});
