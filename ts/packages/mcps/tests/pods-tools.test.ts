import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { settingsRouteState } from "@pe/agent-contracts";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { RouteWorkspace } from "../../runtime/src/route-workspace.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";
import { bodyText } from "./body-text.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("Pea enumerates Pod members and proposes revision-checked Work without route handlers", () =>
  withInvocationContext({ hostBaseUrl: "http://pods.test" }, async () => {
    const registrations = createRouteRegistrations();
    const rows = new Map<string, unknown>();
    const runtime = new RouteWorkspace({
      registrations,
      store: {
        getState: async ({ targetKey, route }) => rows.get(targetKey + route),
        setState: async ({ targetKey, route, value }) => {
          rows.set(targetKey + route, structuredClone(value));
        },
      },
    });
    const scope = { binding: "workspace", route: "pods", target: null, work: "member-a" } as const;
    const member = { pod: "demo", path: "settings/a.json" };
    // The host owns observed member bytes; authors can only change shared Work.
    await runtime.publish(
      scope,
      "pods",
      [{ path: ["basis"], value: { member, rawContent: '{"x":1}', sha256: "v1" } }],
      0,
    );
    vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/pe/capabilities")
        return Response.json({
          at: new Date(0).toISOString(),
          sources: {},
          diagnostics: [],
          machine: machineFixture(),
          capabilities: buildCapabilities({
            ops: tsOnlyOperationCatalog,
            routes: registrations.map((row) => row.spec),
            packages: [],
            skills: [],
          }),
        });
      if (url.pathname === "/ops") return Response.json({ operations: tsOnlyOperationCatalog });
      if (url.pathname === "/call") {
        expect(JSON.parse(await bodyText(init)).key).toBe("pod.list");
        return Response.json({
          pods: [{ folder: "demo", members: [{ path: member.path, sha256: "v1" }] }],
          unreadable: [],
        });
      }
      if (url.pathname === "/pe/route-state/pods")
        return Response.json(await runtime.view(scope, "pods"));
      if (url.pathname === "/pe/route-state/pods/apply") {
        const body = JSON.parse(await bodyText(init));
        return Response.json(
          await runtime.apply(scope, "pods", "agent", body.patches, body.expectedRevision),
        );
      }
      throw Error(`Unexpected ${url.href}`);
    });
    const run = (
      tool: typeof peDo | typeof peRead | typeof peFind,
      input: Record<string, unknown>,
    ) =>
      tool.execute!({ timeoutSeconds: 30, limit: 50, ...input } as never, {} as never) as Promise<
        Record<string, unknown>
      >;
    const found = await run(peFind, { query: "pod members" });
    expect(found).toMatchObject({
      matches: expect.arrayContaining([expect.objectContaining({ key: "op:pod.list" })]),
    });
    expect(await run(peRead, { key: "op:pod.list" })).toMatchObject({
      ok: true,
      result: { pods: [{ members: [{ path: member.path }] }] },
    });
    expect(await run(peRead, { key: "route:pods", workspaceId: "member-a" })).toMatchObject({
      ok: true,
      result: { revision: 1, doc: { basis: { member } } },
    });
    const suggestion = {
      key: "route:pods.edit",
      workspaceId: "member-a",
      expectedRevision: 1,
      input: { patches: [{ path: ["fields", "/x", "suggestion"], value: { value: 2 } }] },
    };
    expect(await run(peDo, suggestion)).toMatchObject({ ok: true });
    expect(await run(peDo, suggestion)).toMatchObject({ ok: false });
    expect(
      await run(peDo, {
        ...suggestion,
        expectedRevision: 2,
        input: { patches: [{ path: ["basis"], value: null }] },
      }),
    ).toMatchObject({ ok: false });
    expect(await run(peRead, { key: "route:pods", workspaceId: "member-a" })).toMatchObject({
      result: { doc: { basis: { sha256: "v1" }, fields: { "/x": { suggestion: { value: 2 } } } } },
    });
    expect(registrations.every((row) => Object.keys(row.handlers).length === 0)).toBe(true);
    expect(settingsRouteState.commands).toEqual({});
  }));
