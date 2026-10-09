import { withInvocationContext } from "../src/shared/invocation-context.ts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { familiesRouteState, hostActions } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import {
  address,
  findCapabilities,
  type CapabilityCatalog,
  type ThreadHead,
} from "@pe/agent-contracts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";

import { bodyText } from "./body-text.ts";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("an op's [Op(Finds)] search terms find it when its key, title, and description do not", () => {
  const rows = buildCapabilities({
    ops: [
      {
        key: "revit.context.show-elements",
        displayName: "Show Elements",
        description: "Select elements and zoom the view to them.",
        searchTerms: ["point-at", "highlight"],
        needs: "document",
        intent: "Read",
      },
      { key: "revit.context.view-image", description: "Export a view.", needs: "document" },
    ],
    routes: [],
    pods: null,
    skills: [],
  });
  expect(findCapabilities(rows, { query: "highlight" }).map((row) => row.key)).toEqual([
    "op:revit.context.show-elements",
  ]);
  expect(findCapabilities(rows, { query: "point at" })[0]?.key).toBe(
    "op:revit.context.show-elements",
  );
});

async function find(input: Record<string, unknown>) {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  vi.stubGlobal("fetch", async () => Response.json(catalog()));
  return (await run(peFind, { limit: 50, ...input })) as {
    matches: Array<{ key: string; description: string; needs: string; input: unknown }>;
    map: { total: number; kinds: Array<{ kind: string }> };
  };
}

test("every host action record is one pe_find row", () => {
  const keys = new Set(catalog().capabilities.map((row) => row.key.replace(/^(op|workflow):/, "")));
  expect(Object.keys(hostActions).filter((key) => !keys.has(key))).toEqual([]);
});

test("pe_find offers operations, collaborative Work, valid Pod entrypoints and skills", async () => {
  const rows = (await find({ query: "", mutates: false })).matches;
  const mutating = (await find({ mutates: true })).matches;
  const keys = [...rows, ...mutating].map((row) => row.key);
  for (const key of [
    "op:scripting.execute",
    "route:instances",
    "route:pods",
    "pod:sheets.rename",
    "skill:build-pod",
  ])
    expect(keys).toContain(key);
  for (const route of ["families", "instances", "parameter-links", "takeoffs"])
    expect(keys).toContain(`route:${route}.propose`);
  expect(keys).not.toContain("pod:broken.run");
  expect(keys.some((key) => key.startsWith("route:ops"))).toBe(false);
  expect(new Set(keys).size).toBe(keys.length);
  for (const row of [...rows, ...mutating])
    expect(z.record(z.string(), z.unknown()).safeParse(row.input).success).toBe(true);
});

test("pe_find maps every kind and ranks and filters visible rows", async () => {
  expect((await find({})).map.kinds.map((row) => row.kind)).toEqual([
    "op",
    "route-doc",
    "route-command",
    "pod",
    "skill",
  ]);
  const view = (await find({ query: "visible families rules" })).matches;
  expect(view.map((row) => row.key)).toContain("route:families.view");
  expect(
    catalog().capabilities.find((row) => row.key === "route:families.set-query")?.mutates,
  ).toBe(true);
  expect((await find({ query: "loaded families" })).matches[0]?.key).toBe(
    "op:revit.catalog.loaded-families",
  );
  expect((await find({ query: "rename sheets" })).matches[0]?.key).toBe("pod:sheets.rename");
  expect(
    (await find({ needs: "project-document" })).matches.every(
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

test("F-H6-2: the Families route tells Pea to propose a scope, then cells against it, without waiting for staging", async () => {
  const read = (await find({ kind: "route-doc" })).matches.find(
    (row) => row.key === "route:families",
  )!.description;
  expect(read).toContain("revit.catalog.loaded-families");
  expect(read).toMatch(/scope\.proposal first[^]*cells[^]*staged scope, else the proposed one/);
  expect(read).toMatch(/do not wait for the person to stage/i);
  expect(read).not.toMatch(/loaded in the staged scope/);
});

test.each([
  "set Width on types of the Elbow family",
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
type Head = ThreadHead & { thread: string };
const turn: Head = {
  thread: "t1",
  defaultTarget: { kind: "named", session: "b1", address: address("C:\\Models\\A.rvt") },
  revision: 4,
};
/** A harness child's call: `PE_THREAD` names the thread, and the host answers its live head. */
async function withHead<T>(head: Head, body: () => Promise<T>): Promise<T> {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.pathname === `/pe/scope/${encodeURIComponent(head.thread)}`
      ? Response.json({ defaultTarget: head.defaultTarget, revision: head.revision })
      : inner(input as string, init);
  }) as typeof fetch;
  try {
    return await withInvocationContext({ thread: head.thread }, body);
  } finally {
    globalThis.fetch = inner;
  }
}
const run = (tool: ExecutableTool, input: unknown, head = turn) =>
  withHead(head, () => tool.execute!(input as never, { agent: { toolCallId: "call-1" } } as never));

test("Families view Pea doors require a mounted pane and return an exact retained reference", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:9");
  const instance = "00000000-0000-4000-8000-000000000001";
  let mounted = false;
  let stale = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/pe/route-view/families" && !mounted)
      return Response.json({ ok: false, error: "no mounted Families view" }, { status: 409 });
    if (url.pathname === "/pe/route-view/families") {
      expect(url.searchParams.get("thread")).toBe(turn.thread);
      return Response.json({
        instance,
        revision: 2,
        stage: "archived",
        query: "blank",
        readingId: "r1",
        document: { session: "s", openId: "o" },
        work: { binding: "host", route: "families", target: null },
        counts: { families: 2, types: 3, parameters: 4 },
        ruleHelp: [{ insert: "blank", label: "blank", hint: "empty values" }],
      });
    }
    if (url.pathname === "/families/readings") {
      expect(url.searchParams.get("format")).toBe("reference");
      return Response.json({
        id: "r1",
        artifact: { url: "/families/readings?id=r1&format=artifact" },
        apsParametersCache: {
          status: "ready",
          artifact: { url: "/families/readings?id=r1&format=parameters-cache" },
        },
      });
    }
    if (url.pathname === "/pe/route-view/families/set-query") {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        thread: turn.thread,
        instance,
        revision: 2,
        query: "filled",
      });
      return Response.json(
        stale
          ? { ok: false, error: "view changed" }
          : { ok: true, query: "filled", counts: { families: 1, types: 2, parameters: 3 } },
        { status: stale ? 409 : 200 },
      );
    }
    throw Error(`unexpected ${url.pathname}`);
  });
  expect(await run(peRead, { key: "route:families.view", timeoutSeconds: 30 })).toMatchObject({
    ok: false,
  });
  mounted = true;
  const view = (await run(peRead, { key: "route:families.view", timeoutSeconds: 30 })) as {
    result: {
      document: { openId: string };
      reading: { artifact: { url: string }; apsParametersCache: { artifact: { url: string } } };
    };
  };
  expect(view.result.document.openId).toBe("o");
  expect(view.result.reading.artifact.url).toBe(
    "http://127.0.0.1:9/families/readings?id=r1&format=artifact",
  );
  expect(view.result.reading.apsParametersCache.artifact.url).toContain("http://127.0.0.1:9/");
  expect(
    await run(peDo, {
      key: "route:families.set-query",
      input: { instance, revision: 2, query: "filled" },
      timeoutSeconds: 30,
    }),
  ).toMatchObject({ ok: true });
  stale = true;
  expect(
    await run(peDo, {
      key: "route:families.set-query",
      input: { instance, revision: 2, query: "filled" },
      timeoutSeconds: 30,
    }),
  ).toMatchObject({ ok: false });
});

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
  const open: Head = {
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

test("an explicit document detour leaves the next call on the thread head default", async () => {
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

test("the live head names an open lifetime; reopen needs an explicit override and host/session work needs no Work", async () => {
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
    const head: Head = {
      thread: "t1",
      defaultTarget: { kind: "open", ref: { session: "b1", openId: "a" } },
      revision: 4,
    };
    const call = (input: unknown) => run(peRead, input, head);
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
      const body = JSON.parse(await bodyText(init));
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
      join(
        checkoutRootFrom(import.meta.dirname)!,
        "docs/features/family/acceptance/parameters.patch.json",
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
        run(peDo, input, {
          ...turn,
          defaultTarget: { kind: "named", session: "ff-proof", address: address(document) },
        });
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
