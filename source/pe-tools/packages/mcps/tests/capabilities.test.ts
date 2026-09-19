import type { PodList } from "@pe/host-contracts/operation-types";
import { readFileSync } from "node:fs";
import { familiesRouteState } from "@pe/agent-contracts";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import {
  address,
  capabilityMap,
  findCapabilities,
  turnContextKey,
  type CapabilityCatalog,
  type Turn,
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
  // What the C# catalog serves for a human verb: `[Op(..., Actor = OpActor.Human)]`.
  ...["families.plan", "families.capture"].map((key) => ({
    key,
    description: "Human verb over loaded families.",
    needs: "project-document" as const,
    intent: "Read" as const,
    actor: "human" as const,
  })),
];

const pods = {
  pods: [
    {
      id: "sheets",
      name: "Sheet tools",
      version: "1.0.0",
      folder: "sheets",
      entrypoints: [{ id: "rename", sourcePath: "src/Rename.cs", name: "Rename sheets" }],
      members: [],
      diagnostics: [],
    },
    {
      id: "broken",
      name: "Broken",
      version: "0.1.0",
      folder: "broken",
      entrypoints: [{ id: "run", sourcePath: "src/Run.cs" }],
      members: [],
      diagnostics: [{ code: "Manifest", path: "pod.json", severity: "error", message: "bad json" }],
    },
  ],
  unreadable: [],
} satisfies PodList;

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
  // Every collaborative route is on cells: each offers Pea a propose door, never a staging one.
  for (const route of ["families", "instances", "parameter-links", "takeoffs"])
    expect(keys).toContain(`route:${route}.propose`);
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
  // /pods is the member editor that replaced /settings; /ops stays a read-only projection.
  expect(keys).toContain("route:pods");
  expect(keys.some((key) => key.startsWith("route:ops"))).toBe(false);
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

test("F-H6-3: plan and capture over loaded families are human verbs; Pea never finds or runs them", async () => {
  const rows = catalog().capabilities;
  const verbs = ["families.plan", "families.capture"].flatMap((key) => [
    `op:${key}`,
    `workflow:${key}`,
  ]);
  for (const key of verbs) expect(rows.find((row) => row.key === key)?.actor).toBe("human");
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  vi.stubGlobal("fetch", async () => Response.json(catalog()));
  try {
    const found = (await run(peFind, { query: "plan capture loaded families", limit: 50 })) as {
      matches: Array<{ key: string }>;
    };
    expect(found.matches.length).toBeGreaterThan(0);
    for (const key of verbs) expect(found.matches.map((row) => row.key)).not.toContain(key);
    const map = (await run(peFind, {})) as { map: { total: number } };
    expect(map.map.total).toBe(rows.filter((row) => row.actor !== "human").length);
    for (const key of verbs)
      for (const tool of [peDo, peRead]) {
        const refused = (await run(tool, { key, timeoutSeconds: 30 })) as {
          isError: boolean;
          content: string;
        };
        expect(refused).toMatchObject({ isError: true, key });
        expect(refused.content).toContain(`'${key}' is human-only`);
      }
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("F-H6-2: the Families route tells Pea to propose a scope, then cells against it, without waiting for staging", () => {
  const read = catalog().capabilities.find((row) => row.key === "route:families")!.description;
  expect(read).toContain("revit.catalog.loaded-families");
  expect(read).toMatch(/scope\.proposal first[^]*cells[^]*staged scope, else the proposed one/);
  expect(read).toMatch(/do not wait for the person to stage/i);
  expect(read).not.toMatch(/loaded in the staged scope/);
});

test.each([
  "set Width on types of the duct fittings",
  "set a parameter value on family types",
  "change type parameters for families",
])("F-B-1: family type changes find the Families propose door: %s", async (query) => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  vi.stubGlobal("fetch", async () => Response.json(catalog()));
  try {
    const found = (await run(peFind, { query, limit: 50 })) as {
      matches: Array<{ key: string }>;
    };
    expect(found.matches[0]?.key).toBe("route:families.propose");
    expect(found.matches.map((row) => row.key)).not.toContain("op:families.plan");
    expect(found.matches.map((row) => row.key)).not.toContain("op:families.capture");
    expect(found.matches.map((row) => row.key)).not.toContain("op:families.apply");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("F-B-2: a Families route read carries its proposed scope types", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const calls: Array<{ url: URL; body?: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/pe/route-state/families")
      return Response.json({
        revision: 1,
        doc: {
          scope: {
            proposal: {
              value: { categoryNames: [], familyNames: ["A"], placementScope: "AllLoaded" },
            },
          },
        },
      });
    if (url.pathname === "/ops") return Response.json({ operations: ops });
    if (body?.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            connected: true,
            openDocuments: [{ openId: "a", address: "C:\\Models\\A.rvt", isFamilyDocument: false }],
          },
        ],
      });
    if (body?.key === "revit.catalog.loaded-families")
      return Response.json({
        families: [{ familyName: "A", types: [{ typeName: "T1" }, { typeName: "T2" }] }],
      });
    throw Error(`unexpected ${url.pathname}`);
  });
  try {
    const read = await run(peRead, { key: "route:families", timeoutSeconds: 30 });
    expect(read).toMatchObject({
      result: { scopeTypes: [{ familyName: "A", typeNames: ["T1", "T2"] }] },
    });
    expect(
      calls.find((call) => call.body?.key === "revit.catalog.loaded-families")?.body,
    ).toMatchObject({ request: { projection: { view: "Rows" } } });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("F-B-2: a Families route read names a missing scope and preserves a catalog failure", async () => {
  for (const [port, document, fails] of [
    ["10", {}, false],
    [
      "11",
      {
        scope: {
          proposal: {
            value: { categoryNames: [], familyNames: ["A"], placementScope: "AllLoaded" },
          },
        },
      },
      true,
    ],
  ] as const) {
    vi.stubEnv("PE_TOOLS_HOST_BASE_URL", `http://127.0.0.1:${port}`);
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (url.pathname === "/pe/capabilities") return Response.json(catalog());
      if (url.pathname === "/pe/route-state/families")
        return Response.json({ revision: 1, doc: document });
      if (url.pathname === "/ops") return Response.json({ operations: ops });
      if (body?.key === "bridge.sessions.list")
        return Response.json({
          sessions: [
            {
              sessionId: "b1",
              connected: true,
              openDocuments: [
                { openId: "a", address: "C:\\Models\\A.rvt", isFamilyDocument: false },
              ],
            },
          ],
        });
      if (body?.key === "revit.catalog.loaded-families" && fails) throw Error("catalog down");
      throw Error(`unexpected ${url.pathname}`);
    });
    try {
      const read = (await run(peRead, { key: "route:families", timeoutSeconds: 30 })) as {
        result: Record<string, unknown>;
      };
      if (fails) expect(read.result.scopeTypesError).toContain("catalog down");
      else {
        expect(read.result.scopeTypes).toBeUndefined();
        expect(read.result.hint).toContain("scope.proposal");
      }
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }
});

type ExecutableTool = { execute?: (input: never, context: never) => Promise<unknown> };
const turn: Turn = {
  id: "11111111-1111-4111-8111-111111111111",
  thread: "t1",
  defaultTarget: { kind: "named", session: "b1", address: address("C:\\Models\\A.rvt") },
  revision: 4,
};
const run = (tool: ExecutableTool, input: unknown, admitted = turn) =>
  tool.execute!(
    input as never,
    {
      agent: { toolCallId: "call-1" },
      requestContext: { [turnContextKey]: admitted },
    } as never,
  );

test("pe_find reads native capabilities under an exact-open turn Target", async () => {
  // Name the host explicitly: without it `base()` discovers no running dev host for this
  // worktree and throws before any fetch, so the URL under test is never built.
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const calls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    calls.push(new URL(input instanceof Request ? input.url : String(input)));
    return Response.json(catalog());
  });
  const result = (await run(
    peFind,
    { query: "loaded families" },
    {
      ...turn,
      defaultTarget: { kind: "open", ref: { session: "exact-session", openId: "exact-document" } },
    },
  )) as { matches: Array<{ key: string }> };
  expect(calls[0]?.search).toBe("?session=exact-session");
  expect(result.matches).toContainEqual(
    expect.objectContaining({ key: "op:revit.catalog.loaded-families" }),
  );
});

test("an exact-open turn Target reads and writes route Work under its document's Address (E2E-J1)", async () => {
  // The browser keys Families Work by the Chat document's Address; a Pea read that dropped the
  // Address hit the Target-less key, found no Work, and reported "unknown route 'families'".
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const projectA = "C:\\Models\\projectA.rvt";
  const routeCalls: URL[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (typeof init?.body === "string" && JSON.parse(init.body).key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            connected: true,
            openDocuments: [{ openId: "project-a", address: projectA, isFamilyDocument: false }],
          },
        ],
      });
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (!url.pathname.includes("/route-state/")) throw Error(`unexpected ${url.pathname}`);
    routeCalls.push(url);
    return url.searchParams.get("target") === projectA
      ? Response.json({ route: "families", revision: 2, doc: {}, ok: true })
      : Response.json({ error: "unknown route 'families'" }, { status: 404 });
  });
  const open: Turn = {
    ...turn,
    defaultTarget: { kind: "open", ref: { session: "b1", openId: "project-a" } },
  };
  try {
    const read = (await run(peRead, { key: "route:families", timeoutSeconds: 30 }, open)) as {
      ok: boolean;
      target: unknown;
      result: { revision: number };
    };
    expect(read).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(read.target).toEqual({ session: "b1", document: projectA });
    const proposed = (await run(
      peDo,
      {
        key: "route:families.propose",
        input: { patches: [{ path: ["intent"], value: "x" }] },
        expectedRevision: 2,
        timeoutSeconds: 30,
      },
      open,
    )) as { ok: boolean };
    expect(proposed.ok).toBe(true);
    expect(routeCalls.map((url) => url.searchParams.get("target"))).toEqual([projectA, projectA]);

    // A Chat document that closed has no Address to key by: refuse, never read Target-less Work.
    const gone = (await run(
      peRead,
      { key: "route:families", timeoutSeconds: 30 },
      {
        ...open,
        defaultTarget: { kind: "open", ref: { session: "b1", openId: "closed" } },
      },
    )) as { isError?: boolean; content?: string };
    expect(gone.isError).toBe(true);
    expect(gone.content).toContain("no longer open");
    expect(routeCalls).toHaveLength(2);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

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
          { key: "pod.list", intent: "Read", needs: "nothing" },
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
    if (typeof init?.body === "string" && JSON.parse(init.body).key === "pod.list")
      return Response.json(pods);

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
      const member = { pod: "pe-standards", path: "settings/ff-route-proof.json" };
      expect(
        await scoped({ key: "route:pods", workspaceId: "settings:resolved-file", input: {} }),
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
              key: "route:pods.propose",
              patches: [
                {
                  path: ["fields", "/parameters/FF_Route_Proof_Count", "proposal"],
                  value: { value: patch.patch.parameters.FF_Route_Proof_Count, by: "pea" },
                },
              ],
            }
          : {
              key: "route:families.propose",
              patches: [{ path: ["work", "profilePath"], value: member.path }],
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
        `/pe/agent/route-state/${route === "family" ? "pods" : "families"}/apply`,
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
