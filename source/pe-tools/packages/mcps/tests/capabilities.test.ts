import { readFileSync } from "node:fs";
import { familiesRouteState } from "@pe/agent-contracts";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import {
  capabilityMap,
  findCapabilities,
  turnContextKey,
  type CapabilityCatalog,
} from "@pe/agent-contracts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";
import { ScopeStore, admitTurn } from "../../runtime/src/scope-store.ts";

const ops = [
  {
    key: "revit.catalog.loaded-families",
    displayName: "Loaded families",
    description: "Inventory of loaded families.",
    needs: "project-document" as const,
    intent: "Read" as const,
    visibility: "ExpertOnly" as const,
    requestSchemaJson: JSON.stringify({ type: "object", title: "LoadedFamiliesRequest" }),
  },
  {
    key: "scripting.execute",
    description: "Run C#.",
    needs: "document" as const,
    intent: "Mutate" as const,
  },
];

const pods = {
  workspacesRootPath: "C:/pods",
  pods: [
    {
      workspaceKey: "sheets",
      workspaceRootPath: "C:/pods/sheets",
      isValid: true,
      manifest: {
        schemaVersion: 1,
        id: "sheets",
        name: "Sheet tools",
        version: "1.0.0",
        entrypoints: [{ id: "rename", sourcePath: "src/Rename.cs", name: "Rename sheets" }],
      },
      diagnostics: [],
    },
    {
      workspaceKey: "broken",
      workspaceRootPath: "C:/pods/broken",
      isValid: false,
      manifest: null,
      diagnostics: [{ stage: "manifest", severity: "Error" as const, message: "bad json" }],
    },
  ],
};

function catalog(): CapabilityCatalog {
  return {
    at: "2026-09-04T00:00:00.000Z",
    sessions: [{ sessionId: "b1", custody: "observed", sdkSessionId: "dev" }],
    sources: { catalog: "ok" },
    capabilities: buildCapabilities({
      ops,
      routes: createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:9" }).map(
        (registration) => registration.spec,
      ),
      pods,
      skills: bundledPeaSkills,
    }),
  };
}

test("every source projects into one row shape with no hidden tier", () => {
  const rows = catalog().capabilities;
  const keys = rows.map((row) => row.key);
  // An ExpertOnly op and a scripting.* op are plain rows now; the tier is a rank, not a filter.
  expect(rows.find((row) => row.key === "op:revit.catalog.loaded-families")?.rank).toBe(0);
  expect(keys).toContain("op:scripting.execute");
  expect(keys).toContain("route:instances");
  expect(keys).toContain("route:instances.propose");
  // Instances lifecycle is a semantic action behind host admission, not a route command.
  expect(rows.find((row) => row.key === "workflow:instances.start")).toMatchObject({
    kind: "op",
    actor: "any",
    mutates: true,
  });
  expect(rows.find((row) => row.key === "workflow:instances.stop")?.actor).toBe("human");
  expect(
    rows.some((row) => row.kind === "route-command" && row.key.startsWith("route:instances")),
  ).toBe(false);
  expect(keys.some((key) => key.startsWith("route:pods") || key.startsWith("route:ops"))).toBe(
    false,
  );
  // Only valid pods become buttons; invalid ones are absent, not hidden.
  expect(rows.filter((row) => row.kind === "pod").map((row) => row.key)).toEqual([
    "pod:sheets.rename",
  ]);
  expect(keys).toContain("skill:build-pod");
  expect(new Set(keys).size).toBe(keys.length);
  for (const row of rows)
    expect(z.record(z.string(), z.unknown()).safeParse(row.input).success).toBe(true);
});

test("no query gives the map; a query ranks across kinds; needs filters replace hiding", () => {
  const rows = catalog().capabilities;
  const map = capabilityMap(rows);
  expect(map.kinds.map((kind) => kind.kind)).toEqual([
    "op",
    "route-doc",
    "route-command",
    "pod",
    "skill",
  ]);
  expect(map.total).toBe(rows.length);
  expect(findCapabilities(rows, { query: "loaded families" })[0]?.key).toBe(
    "op:revit.catalog.loaded-families",
  );
  expect(findCapabilities(rows, { query: "rename sheets" })[0]?.key).toBe("pod:sheets.rename");
  expect(
    findCapabilities(rows, { query: "instances.start", kind: "op" })
      .slice(0, 2)
      .map((row) => row.key),
  ).toContain("workflow:instances.start");
  expect(
    findCapabilities(rows, { needs: "project-document" }).every(
      (row) => row.needs === "project-document",
    ),
  ).toBe(true);
});

type ExecutableTool = { execute?: (input: never, context: never) => Promise<unknown> };
const turn = {
  id: "11111111-1111-4111-8111-111111111111",
  thread: "t1",
  defaultTarget: { kind: "named", session: "b1", address: "C:\\Models\\A.rvt" },
  revision: 4,
};
const run = (tool: ExecutableTool, input: unknown) =>
  tool.execute!(
    input as never,
    { agent: { toolCallId: "call-1" }, requestContext: { [turnContextKey]: turn } } as never,
  );

test("an explicit document detour leaves the next call on the frozen turn default", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const targets: string[][] = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/ops") return Response.json({ operations: ops });
    const headers = new Headers(init?.headers);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (body.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            sdkSessionId: "dev",
            connected: true,
            openDocuments: [
              { openId: "a", address: "C:\\Models\\A.rvt", isFamily: false },
              { openId: "b", address: "C:\\Models\\B.rvt", isFamily: false },
            ],
          },
        ],
      });
    targets.push([
      headers.get("x-pe-bridge-session-id") ?? "",
      headers.get("x-pe-open-document-id") ?? "",
    ]);
    return Response.json({ families: 3 });
  });
  try {
    const before = structuredClone(turn);
    const override = await run(peRead, {
      key: "op:revit.catalog.loaded-families",
      timeoutSeconds: 30,
      target: { kind: "open", ref: { session: "b1", openId: "b" } },
    });
    expect(override).toMatchObject({ ok: true, revision: 4 });
    await run(peRead, { key: "op:revit.catalog.loaded-families", timeoutSeconds: 30 });
    expect(targets).toEqual([
      ["b1", "b"],
      ["b1", "a"],
    ]);
    expect(turn).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("real turn admission freezes an open lifetime; reopen needs an explicit override and host/session work needs no Work", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  let openId = "a";
  const dispatches: Array<{ key: string; session: string | null; document: string | null }> = [];
  const source = catalog();
  source.capabilities.push(
    ...buildCapabilities({
      ops: [
        { key: "host.status", needs: "nothing", intent: "Read" },
        { key: "revit.family.inspect", needs: "family-document", intent: "Read" },
        { key: "revit.context.document-session", needs: "nothing", intent: "Read" },
      ],
      routes: [],
      pods: null,
      skills: [],
    }),
  );
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/pe/capabilities") return Response.json(source);
    if (url.pathname === "/ops") return Response.json({ operations: [] });
    expect(url.pathname).toBe("/call");
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (body.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            sdkSessionId: "dev",
            connected: true,
            openDocuments: [
              { openId, address: "C:\\Models\\A.rvt", isFamilyDocument: false },
              { openId: "family", address: "C:\\Models\\F.rfa", isFamilyDocument: true },
            ],
          },
          { sessionId: "idle", connected: true, openDocuments: [] },
        ],
      });
    const headers = new Headers(init?.headers);
    dispatches.push({
      key: body.key,
      session: headers.get("x-pe-bridge-session-id"),
      document: headers.get("x-pe-open-document-id"),
    });
    return Response.json({ done: true });
  });
  try {
    const head = {
      defaultTarget: { kind: "open", ref: { session: "b1", openId: "a" } },
      revision: 4,
    };
    const scopes = new ScopeStore(
      async () => ({
        getState: async () => head,
        setState: async () => {
          throw Error("unexpected Work/head write");
        },
      }),
      "resource",
    );
    let context: unknown;
    await admitTurn(
      scopes,
      {
        thread: { requireId: () => "t1" },
        sendSignal: (_signal: unknown, options: unknown) => {
          context = options;
          return { accepted: Promise.resolve() };
        },
      } as never,
      { content: "inspect" },
    );
    const call = (input: unknown) => peRead.execute!(input as never, context as never);
    expect(
      await call({ key: "op:revit.catalog.loaded-families", timeoutSeconds: 30 }),
    ).toMatchObject({ ok: true, revision: 4 });
    expect(
      await call({
        key: "op:revit.family.inspect",
        timeoutSeconds: 30,
        target: { kind: "open", ref: { session: "b1", openId: "family" } },
      }),
    ).toMatchObject({ ok: true, revision: 4 });
    expect(
      await call({ key: "op:revit.catalog.loaded-families", timeoutSeconds: 30 }),
    ).toMatchObject({ ok: true, revision: 4 });
    openId = "a2";
    expect(
      await call({ key: "op:revit.catalog.loaded-families", timeoutSeconds: 30 }),
    ).toMatchObject({ ok: false, content: expect.stringContaining("document-closed") });
    expect(
      await call({
        key: "op:revit.catalog.loaded-families",
        timeoutSeconds: 30,
        target: { kind: "open", ref: { session: "b1", openId: "a2" } },
      }),
    ).toMatchObject({ ok: true, revision: 4 });
    expect(
      await call({
        key: "op:revit.catalog.loaded-families",
        timeoutSeconds: 30,
        target: { kind: "open", ref: { session: "b1", openId: "family" } },
      }),
    ).toMatchObject({ ok: false, content: expect.stringContaining("wrong-document-kind") });
    expect(
      await peRead.execute!({ key: "op:host.status", timeoutSeconds: 30 } as never, {} as never),
    ).toMatchObject({ ok: true });
    expect(
      await peRead.execute!(
        { key: "op:revit.context.document-session", target: "idle", timeoutSeconds: 30 } as never,
        {} as never,
      ),
    ).toMatchObject({ ok: true });
    expect(dispatches.map(({ session, document }) => [session, document])).toEqual([
      ["b1", "a"],
      ["b1", "family"],
      ["b1", "a"],
      ["b1", "a2"],
      [null, null],
      ["idle", null],
    ]);
    expect(await scopes.read("t1")).toEqual(head);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("the doors ride the host under the turn Target and name the revision and resolved target", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const calls: Array<{ method: string; url: URL; headers: Headers; body?: unknown }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/ops")
      return Response.json({
        operations: [
          ...ops,
          { key: "scripting.execute", intent: "Mutate", needs: "document" },
          { key: "scripting.pod.list", intent: "Read", needs: "nothing" },
        ],
      });
    if (url.pathname === "/actions") {
      if (!init?.body) return Response.json([]);
      const body = JSON.parse(String(init.body));
      return Response.json({
        id: body.id,
        kind: body.kind,
        key: body.key,
        actor: body.actor,
        destination: body.destination,
        request: body.input,
        bases: body.bases,
        state: "succeeded",
        steps: [],
        preparation: { state: "ready", value: {} },
        recovery: [],
        publication: { state: "unrequested" },
        startedAt: new Date().toISOString(),
        result: { success: true },
      });
    }
    if (typeof init?.body === "string" && JSON.parse(init.body).key === "scripting.pod.list")
      return Response.json({
        pods: [
          {
            workspaceKey: "sheets",
            manifest: { entrypoints: [{ id: "rename", sourcePath: "src/Rename.cs" }] },
          },
        ],
      });

    if (typeof init?.body === "string" && JSON.parse(init.body).key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            connected: true,
            openDocuments: [{ openId: "a", address: "C:\\Models\\A.rvt", isFamilyDocument: false }],
          },
        ],
      });
    if (url.pathname === "/call")
      return Response.json(
        { families: 3 },
        {
          headers: {
            "x-pe-resolved-session": "dev",
            "x-pe-resolved-document": encodeURIComponent("C:\\Models\\A.rvt"),
          },
        },
      );
    if (url.pathname.startsWith("/pe/route-state/instances"))
      return Response.json({ revision: 2, doc: { selectedSession: null } });
    return Response.json({ ok: true, revision: 3 });
  });
  try {
    const map = (await run(peFind, {})) as {
      map: { total: number };
      sessions: unknown[];
      revision: number;
    };
    expect(map.map.total).toBeGreaterThan(10);
    expect(map.sessions).toHaveLength(1);
    expect(map.revision).toBe(4);
    // The catalog is read for the turn's Target Address, never for a model-typed selector.
    expect(calls[0]?.url.search).toBe("?target=C%3A%5CModels%5CA.rvt");

    const op = (await run(peRead, {
      key: "op:revit.catalog.loaded-families",
      timeoutSeconds: 30,
    })) as { ok: boolean; revision: number; target: { session: string; document: string } };
    expect(op.ok).toBe(true);
    expect(op.revision).toBe(4);
    expect(op.target).toEqual({ session: "dev", document: "C:\\Models\\A.rvt" });
    expect(calls.at(-1)?.headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe("b1");
    expect(calls.at(-1)?.body).toEqual({ key: "revit.catalog.loaded-families", request: {} });

    const mutating = (await run(peRead, { key: "op:scripting.execute", timeoutSeconds: 30 })) as {
      isError: boolean;
      content: string;
    };
    expect(mutating.isError).toBe(true);
    expect(mutating.content).toContain("pe_do");

    const read = (await run(peRead, { key: "route:instances", timeoutSeconds: 30 })) as {
      ok: boolean;
      target: { session: string | null; document: string | null };
    };
    expect(read.ok).toBe(true);
    // Instances Work is workspace-owned, not document-scoped: the read touches no Revit and names no model.
    expect(read.target).toEqual({ session: null, document: null });
    expect(calls.at(-1)?.url.pathname).toBe("/pe/route-state/instances");
    expect(calls.at(-1)?.url.search).toBe("?work=instances");

    // SDK observations are a host reading, never authored Work: no route command, no revision.
    const reading = (await run(peRead, {
      key: "op:instances.read",
      input: { read: "sessions" },
      timeoutSeconds: 30,
    })) as { ok: boolean };
    expect(reading.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/instances/readings");
    expect(calls.at(-1)?.url.search).toBe("?read=sessions");

    const pod = (await run(peDo, { key: "pod:sheets.rename", timeoutSeconds: 30 })) as {
      ok: boolean;
    };
    expect(pod.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/actions");
    expect(calls.at(-1)?.body).toMatchObject({
      kind: "operation",
      key: "scripting.execute",
      actor: "agent",
      input: { sourcePath: "src/Rename.cs", workspaceKey: "sheets" },
    });

    const human = (await run(peDo, { key: "workflow:instances.stop", timeoutSeconds: 30 })) as {
      isError: boolean;
      content: string;
    };
    expect(human.isError).toBe(true);
    expect(human.content).toContain("human-only");

    const skill = (await run(peRead, { key: "skill:build-pod", timeoutSeconds: 30 })) as {
      result: string;
    };
    expect(skill.result).toContain("name: build-pod");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("Pea doors author native JSON and plan both family routes under the turn Target", async () => {
  const patch = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../docs/features/family/acceptance/parameters.patch.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const writes: Array<{ url: URL; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (typeof init?.body === "string") {
      writes.push({ url, body: JSON.parse(init.body) });
      return Response.json({ ok: true, revision: 13 });
    }
    return Response.json({ revision: 12, doc: {} });
  });
  try {
    for (const route of ["family", "families"] as const) {
      const document = `C:\\Models\\FFRouteProof.${route === "family" ? "rfa" : "rvt"}`;
      const scoped = (input: unknown) =>
        peDo.execute!(
          input as never,
          {
            agent: { toolCallId: `ff-${route}` },
            requestContext: {
              [turnContextKey]: {
                ...turn,
                defaultTarget: { kind: "named", session: "ff-proof", address: document },
              },
            },
          } as never,
        );
      const documentId = {
        moduleKey: "FamilyFoundry",
        rootKey: route === "family" ? "models" : "patches",
        relativePath: "ff-route-proof",
      };
      expect(
        await scoped({ key: "route:settings", workspaceId: "settings:resolved-file", input: {} }),
      ).toMatchObject({ ok: true, target: { session: null, document: null } });
      expect(await scoped({ key: "op:settings.write", input: {} })).toMatchObject({
        isError: true,
      });
      if (route === "families") {
        // Families advertises no route command at all; the plan is a host read.
        expect(familiesRouteState.commands).toEqual({});
        expect(
          await scoped({ key: "route:families.plan", input: {}, timeoutSeconds: 30 }),
        ).toMatchObject({ isError: true });
      } else
        expect(await scoped({ key: "route:family.plan", input: {} })).toMatchObject({
          isError: true,
        });
      const proposal =
        route === "family"
          ? {
              key: "route:settings.propose",
              patches: [
                {
                  path: ["fields", "/parameters/FF_Route_Proof_Count", "proposal"],
                  value: { value: patch.patch.parameters.FF_Route_Proof_Count, by: "pea" },
                },
              ],
            }
          : {
              key: "route:families.propose",
              patches: [{ path: ["work", "profilePath"], value: documentId.relativePath }],
            };
      expect(
        await scoped({
          key: proposal.key,
          workspaceId: route === "family" ? "settings:resolved-file" : undefined,
          input: { patches: proposal.patches },
          expectedRevision: 12,
          timeoutSeconds: 30,
        }),
      ).toMatchObject({ ok: true });
      expect(writes.at(-1)?.url.pathname).toBe(
        `/pe/agent/route-state/${route === "family" ? "settings" : "families"}/apply`,
      );
      expect(writes.at(-1)?.body).toEqual({ patches: proposal.patches, expectedRevision: 12 });
      const before = writes.length;
      expect(
        await scoped({ key: `route:${route}.apply`, input: {}, timeoutSeconds: 30 }),
      ).toMatchObject({ isError: true });
      expect(writes).toHaveLength(before);
    }
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
