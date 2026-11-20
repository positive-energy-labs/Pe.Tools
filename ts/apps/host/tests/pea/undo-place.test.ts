import { expect, test, vi } from "vite-plus/test";
import { emptyThreadHead } from "@pe/agent-contracts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { buildCapabilities } from "../../../../packages/mcps/src/pea/capabilities.ts";
import { peDo } from "../../../../packages/mcps/src/pea/capability-tools.ts";
import { fakeRuntimeHost } from "../../../../packages/mcps/tests/runtime-host-fixture.ts";
import { routeRegistry } from "../../src/routes.generated.ts";
import { projectRouteRead } from "../../src/reads/routes.ts";

const catalog = () => ({
  at: "2026-11-16T00:00:00Z",
  machine: machineFixture([{ session: "b1", documents: null }]),
  sources: { catalog: "ok" },
  diagnostics: [],
  capabilities: buildCapabilities({
    ops: [],
    routes: [routeRegistry.fans!.host.workState as never],
    packages: [],
    skills: [],
  }),
});

test("Pea undo falls back to its owner when the Place read returns non-JSON", async () => {
  vi.stubEnv("PE_CONTEXT", "context-t1");
  fakeRuntimeHost("http://127.0.0.1:9");
  const project = "C:\\Models\\projectA.rvt";
  const ref = { session: "b1", openId: "project-a" };
  const fansWork = { binding: "address", route: "fans", target: project };
  const works = [fansWork];
  const step = { work: fansWork, revision: 7, label: "Edit supply velocity" };
  const reads: { read: string; args: { works?: { route: string }[] } }[] = [];
  const historyBodies: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.pathname === "/pe/scope/self")
      return Response.json({
        ...emptyThreadHead,
        thread: "t1",
        revision: 4,
        targets: [{ request: { kind: "open", ref }, admission: null }],
      });
    if (body?.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            connected: true,
            openDocuments: [{ openId: "project-a", address: project, isFamilyDocument: false }],
          },
        ],
      });
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/pe/reads/value") {
      if (body.release) return Response.json({ value: null, state: "superseded" });
      if (body.read.startsWith("route:"))
        return Response.json({ value: { data: projectRouteRead(routeRegistry.fans!.host) } });
      reads.push(body);
      if (body.read === "fans.roster") return new Response("Unavailable", { status: 503 });
      expect(body).toMatchObject({ read: "work.timeline", args: { works } });
      return Response.json({
        value: {
          data: {
            rows: [],
            undo: step,
            redo: null,
            refusal: { undo: null, redo: null },
          },
        },
      });
    }
    if (!url.pathname.includes("/route-state/fans")) throw Error(`unexpected ${url.pathname}`);
    if (url.pathname.endsWith("/history")) historyBodies.push(body);
    return Response.json({
      route: "fans",
      revision: 4,
      handle: { key: fansWork, revision: 4 },
      doc: {},
      ok: true,
    });
  });
  try {
    const undone = await peDo.execute!(
      {
        key: "route:fans.history",
        input: { direction: "undo" },
        expectedRevision: 4,
        timeoutSeconds: 30,
      } as never,
      { agent: { toolCallId: "call-1" } } as never,
    );
    expect(undone, JSON.stringify(undone)).toMatchObject({ ok: true });
    expect(reads[0]).toMatchObject({ read: "fans.roster", args: { target: ref } });
    // An unreadable Place adds no member; the owner's offered step still reaches history.
    expect(historyBodies).toEqual([{ direction: "undo", works, expected: step }]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
