import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { normalizePeError } from "@pe/host-contracts/pe-api";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { join } from "node:path";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  address,
  documentRows,
  familiesRouteState,
  type CapabilityCatalog,
  type ThreadHead,
  emptyThreadHead,
} from "@pe/agent-contracts";
import { buildCapabilities, createCapabilityCatalogSource } from "../src/pea/capabilities.ts";
import { builtinPeaSkillSnapshots } from "../src/pea/skill-publication.ts";
import type { PackageProjection } from "@pe/agent-contracts";
import { peDo, peRead, peFind } from "../src/pea/capability-tools.ts";

import { nativeFixture } from "../../../apps/host/tests/fans-native.fixture.ts";
import capturedWalk from "../../../apps/host/tests/native-recordings/driver-ducts.snapshot.walk.json" with { type: "json" };
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { commands } from "@pe/agent-contracts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import bindGraph from "../src/pea/generated/bind-graph.json" with { type: "json" };
import opsGraph from "../src/pea/generated/ops-graph.json" with { type: "json" };
import { RouteGraphJson } from "../../agent-contracts/src/route-kernel-data.ts";
import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { contextFetch, withInvocationContext } from "@pe/runtime/context";
import { createMcpDoor } from "../../../apps/host/src/mcp-route.ts";
import {
  admitCrossing,
  bindControl,
  callerOf,
  mintContext,
  retireContext,
  Refused,
} from "../../../apps/host/src/control.ts";

const ops = hostOpCatalog.filter((op) =>
  [
    "revit.catalog.loaded-families",
    "scripting.execute",
    "families.plan",
    "families.capture",
  ].includes(op.key),
);

const packages: PackageProjection[] = [
  {
    id: "sheets",
    folder: "sheets",
    diagnostics: [],
    members: [{ path: "src/Rename.cs", sha256: "a".repeat(64), sizeBytes: 1 }],
    contributions: [
      {
        key: "script:@sheets/src/Rename.cs",
        sourcePath: "src/Rename.cs",
        title: "Sheet tools: Rename sheets",
        description: "",
      },
    ],
  },
];
const admittedSkills = builtinPeaSkillSnapshots();

function catalog(): CapabilityCatalog {
  return {
    at: "2026-09-04T00:00:00.000Z",
    machine: machineFixture([{ session: "b1", documents: null }]),
    sources: { catalog: "ok" },
    diagnostics: [],
    capabilities: buildCapabilities({
      ops,
      routes: [familiesRouteState],
      packages,
      skills: admittedSkills,
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("contextFetch carries the process token, isolates bound MCP contexts, and keeps foreign origins free of caller identity", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "process-context");
  const seen: Array<{ url: string; token: string | null }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: input instanceof Request ? input.url : String(input),
      token: new Headers(init?.headers).get("x-pe-context"),
    });
    return Response.json({});
  });
  await contextFetch("http://127.0.0.1:9/actions", { method: "POST" });
  await Promise.all(
    ["one", "two"].map((token) =>
      withInvocationContext(
        { hostBaseUrl: "http://127.0.0.1:9", headers: { "x-pe-context": token } },
        async () => {
          await contextFetch("http://127.0.0.1:9/pe/capabilities");
          await contextFetch("https://docs.example/test");
        },
      ),
    ),
  );
  expect(
    seen
      .filter((request) => request.url.startsWith("http://127.0.0.1"))
      .map((request) => request.token),
  ).toEqual(["process-context", "one", "two"]);
  expect(
    seen
      .filter((request) => request.url.startsWith("https://docs.example"))
      .map((request) => request.token),
  ).toEqual([null, null]);
});

test.each(["http", "stdio"])(
  "F-a %s: an MCP-only client reads documents and refuses every write until pairing",
  async (transport) => {
    vi.stubEnv("PE_CONTEXT", "");
    const user = { session: "you", openId: "a" };
    const own = { session: "pea", openId: "copy" };
    const other = { session: "you", openId: "b" };
    const head: ThreadHead = {
      revision: 7,
      targets: [
        {
          request: { kind: "open", ref: user },
          admission: { revision: 7, at: new Date().toISOString(), via: "local" },
        },
      ],
    };
    bindControl({
      acquired: (ref) => (ref.session === "pea" ? "acq-copy" : null),
      acquiredSession: (session) => (session === "pea" ? "acq-pea" : null),
      heads: () => head,
    });
    const nativeOps = [
      ...ops,
      {
        subject: "None",
        touches: "Metadata",
        effect: "Read",
        cardinality: "One",
        costTier: "Cheap" as const,
        key: "revit.context.view-image",
        intent: "Read" as const,
        needs: "document" as const,
      },
    ];
    const sessions = [user, own, other].map((ref) => ({
      sessionId: ref.session,
      custody: "controlled" as const,
      connected: true,
      openDocuments: [
        {
          openId: ref.openId,
          address: `C:/Models/${ref.openId}.rvt`,
          title: ref.openId,
          isActive: true,
          isFamilyDocument: false,
        },
      ],
    }));
    // One inventory row per session, including both user documents.
    sessions[0]!.openDocuments.push(sessions.pop()!.openDocuments[0]!);
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const capturePath = `/captures/${createHash("sha256").update(image).digest("hex")}.png`;
    const writes: Array<{ caller: unknown; target: unknown; basis: unknown }> = [];
    const reads: Array<{ key: string; ref: unknown }> = [];
    const tokens = new Set<string>();
    const rows = new Map<string, unknown>();
    let hostBase = "";
    const door = createMcpDoor(() => hostBase);
    const backend = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(",") : (value ?? ""),
          ]),
        );
        const identity = callerOf({ kind: "local" }, headers);
        if ("refusal" in identity) return Response.json(identity, { status: 403 });
        if (headers["x-pe-context"]) tokens.add(headers["x-pe-context"]);
        const url = new URL(req.url!, hostBase);
        if (url.pathname === "/mcp")
          return withInvocationContext(
            { principal: { kind: "local" }, caller: identity.caller, headers: {} },
            () =>
              door.fetch(
                new Request(url, { method: req.method, headers, ...(body ? { body } : {}) }),
              ),
          );
        if (url.pathname === "/pe/scope/self")
          return identity.caller.kind === "pea"
            ? Response.json({ thread: identity.caller.thread, ...head })
            : Response.json({ error: "no thread" }, { status: 404 });
        if (url.pathname === "/pe/capabilities")
          return Response.json({
            at: new Date().toISOString(),
            machine: machineFixture(
              sessions.map((s) => ({ session: s.sessionId, documents: s.openDocuments })),
            ),
            sources: {},
            diagnostics: [],
            capabilities: buildCapabilities({
              ops: nativeOps,
              routes: [],
              packages: [],
              skills: [],
            }),
          });
        if (url.pathname === "/ops") return Response.json({ operations: nativeOps });
        if (url.pathname === capturePath)
          return new Response(image, { headers: { "content-type": "image/png" } });
        if (url.pathname === "/call") {
          const { key } = JSON.parse(body);
          if (key === "bridge.sessions.list") return Response.json({ sessions });
          const ref = {
            session: headers["x-pe-bridge-session-id"],
            openId: headers["x-pe-open-document-id"],
          };
          reads.push({ key, ref });
          return key === "revit.context.view-image"
            ? Response.json(
                { view: { label: "User view" }, byteSize: image.length, width: 1500, height: 1500 },
                { headers: { "x-pe-capture-id": "f-a", "x-pe-capture-url": capturePath } },
              )
            : Response.json({ families: 3 });
        }
        if (url.pathname === "/actions") {
          if (req.method !== "POST")
            return Response.json(
              rows.has(url.searchParams.get("id")!) ? [rows.get(url.searchParams.get("id")!)] : [],
            );
          const { input, ...admission } = JSON.parse(body);
          try {
            const basis = admitCrossing(identity.caller, admission.target, "/actions");
            writes.push({ caller: identity.caller, target: admission.target, basis });
            const row = {
              ...admission,
              caller: identity.caller,
              basis,
              input,
              state: "succeeded",
              result: { status: "Succeeded" },
              steps: [],
              prepared: { state: "unprepared" },
              recovery: [],
              startedAt: new Date().toISOString(),
            };
            rows.set(admission.id, row);
            return Response.json(row);
          } catch (error) {
            if (!(error instanceof Refused)) throw error;
            return Response.json(
              {
                error: error.message,
                message: error.message,
                refusal: error.refusal,
                notDispatched: true,
              },
              { status: 403 },
            );
          }
        }
        throw Error(`Unexpected fake host request ${url}`);
      })()
        .then(normalizePeError)
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch((error) => {
          res.writeHead(500);
          res.end(String(error));
        });
    });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const bound = backend.address();
    if (!bound || typeof bound === "string") throw Error("No fake host port");
    hostBase = fakeRuntimeHost(`http://127.0.0.1:${bound.port}`);
    const clients: Client[] = [];
    const peaToken = mintContext({ kind: "pea", thread: "chat" });
    try {
      const connect = async (headers: Record<string, string>) => {
        const client = new Client({ name: "f-a", version: "1" });
        clients.push(client);
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${hostBase}/mcp`), {
            requestInit: { headers },
          }),
        );
        return client;
      };
      const client =
        transport === "http"
          ? await connect({ "x-pe-thread": "chat" })
          : new Client({ name: "f-a", version: "1" });
      if (transport === "stdio") {
        clients.push(client);
        const root = checkoutRootFrom(import.meta.dirname)!;
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [
              join(root, "ts/node_modules/jiti/lib/jiti-cli.mjs"),
              join(root, "ts/apps/pea/src/main.ts"),
              "mcp",
              "--host",
              hostBase,
            ],
            env: {
              ...(Object.fromEntries(
                Object.entries(process.env).filter(([, value]) => typeof value === "string"),
              ) as Record<string, string>),
              PE_CONTEXT: "",
            },
            stderr: "pipe",
          }),
        );
      }
      const call = (name: string, args: Record<string, unknown>) =>
        client.callTool({ name, arguments: args });
      const read = await call("pe_read", {
        key: "op:revit.catalog.loaded-families",
        target: { kind: "open", ref: user },
      });
      expect(read.isError, JSON.stringify(read)).not.toBe(true);
      const captured = await call("capture_view", { target: { kind: "open", ref: user } });
      expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
      expect(captured.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "image" })]),
      );
      const beforeInvalid = reads.length;
      const invalidCapture = await call("capture_view", {
        target: { kind: "named", address: "C:/Models/a.rvt", session: "you" },
      });
      expect(invalidCapture.isError).toBe(true);
      expect(reads).toHaveLength(beforeInvalid);
      const refused = await call("pe_do", {
        key: "op:scripting.execute",
        target: { kind: "open", ref: user },
        input: { scriptContent: "WriteLine(1);" },
      });
      expect(JSON.stringify(refused)).toContain("grant.context-cannot-hold");
      expect(writes).toEqual([]);
      const moved = await call("target_set", { add: { kind: "open", ref: user } });
      expect(moved.isError).toBe(true);
      expect(JSON.stringify(moved)).toContain("grant.required");
      const result = await call("pe_do", {
        key: "op:scripting.execute",
        target: { kind: "open", ref: own },
        input: { scriptContent: "WriteLine(1);" },
      });
      expect(JSON.stringify(result)).toContain("grant.context-cannot-hold");
      expect(writes).toEqual([]);
      expect(reads).toEqual(
        expect.arrayContaining([{ key: "revit.context.view-image", ref: user }]),
      );
      expect(tokens.size).toBe(1);
      // Chat keeps its one target, writes it and Pea's detours, and refuses another user lifetime under Guarded.
      const chat = await connect({ "x-pe-context": peaToken });
      const beforeNamedCapture = reads.length;
      expect(
        (
          await chat.callTool({
            name: "capture_view",
            arguments: { target: { kind: "named", address: "C:/Models/copy.rvt", session: "pea" } },
          })
        ).isError,
      ).toBe(true);
      expect(reads).toHaveLength(beforeNamedCapture);
      expect(
        (
          await chat.callTool({
            name: "capture_view",
            arguments: { target: { kind: "open", ref: own } },
          })
        ).isError,
      ).not.toBe(true);
      expect((await chat.callTool({ name: "capture_view", arguments: {} })).isError).not.toBe(true);
      expect(reads.slice(-2)).toEqual([
        { key: "revit.context.view-image", ref: own },
        { key: "revit.context.view-image", ref: user },
      ]);
      const chatCall = (ref?: typeof user) =>
        chat.callTool({
          name: "pe_do",
          arguments: {
            key: "op:scripting.execute",
            ...(ref ? { target: { kind: "open", ref } } : {}),
          },
        });
      expect(
        JSON.parse(((await chatCall(other)).content as Array<{ text: string }>)[0]!.text),
      ).toMatchObject({ ok: true });
      expect(
        JSON.parse(((await chatCall()).content as Array<{ text: string }>)[0]!.text),
      ).toMatchObject({ ok: true, revision: 7 });
      expect(
        JSON.parse(((await chatCall(own)).content as Array<{ text: string }>)[0]!.text),
      ).toMatchObject({ ok: true });
      expect(head.targets.map((target) => target.request)).toEqual([{ kind: "open", ref: user }]);
      expect(writes[0]).toMatchObject({
        basis: null,
        target: { kind: "document", ref: other },
      });
    } finally {
      for (const client of clients) await client.close();
      await door.close();
      retireContext(peaToken);
      bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
    }
  },
  15_000,
);

test("a cached catalog still reads the open documents fresh: a closed one is gone on the next read", async () => {
  fakeRuntimeHost("http://127.0.0.1:19");
  let open = [
    { openId: "o1", title: "A.rvt", address: null, isFamilyDocument: false, isActive: true },
  ];
  let opsReads = 0;
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/ops") {
      opsReads += 1;
      return Response.json({ operations: ops });
    }
    return Response.json({ sessions: [{ sessionId: "b1", connected: true, openDocuments: open }] });
  });
  const source = createCapabilityCatalogSource({
    machine: async () => machineFixture([{ session: "b1", documents: open }]),
    hostBaseUrl: "http://127.0.0.1:19",
    registrations: [],
  });
  expect(documentRows(await source.read()).map((row) => row.key)).toEqual(["doc:b1/o1"]);
  open = [];
  const again = await source.read();
  expect(documentRows(again)).toEqual([]);
  expect(opsReads).toBe(1);
});

type ExecutableTool = { execute?: (input: never, context: never) => Promise<unknown> };
type Head = ThreadHead & { thread: string };
const turn: Head = {
  thread: "t1",
  targets: [
    {
      request: { kind: "named", session: "b1", address: address("C:\\Models\\A.rvt") },
      admission: null,
    },
  ],
  revision: 4,
};
/** A harness child's call: its context names the thread, and the host answers `/pe/scope/self`. */
async function withHead<T>(head: Head, body: () => Promise<T>): Promise<T> {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.pathname === "/pe/scope/self"
      ? Response.json({ ...emptyThreadHead, ...head })
      : inner(input as string, init);
  }) as typeof fetch;
  const context = process.env.PE_CONTEXT;
  process.env.PE_CONTEXT = `context-${head.thread}`;
  try {
    return await body();
  } finally {
    globalThis.fetch = inner;
    if (context === undefined) delete process.env.PE_CONTEXT;
    else process.env.PE_CONTEXT = context;
  }
}
const run = (tool: ExecutableTool, input: unknown, head = turn) =>
  withHead(head, () => tool.execute!(input as never, { agent: { toolCallId: "call-1" } } as never));

test("Pea discovers the sheet plan, decodes any route's handle, and previews Ducts", async () => {
  fakeRuntimeHost("http://127.0.0.1:19999");
  const f = await nativeFixture();
  try {
    const staged = await f.saved.apply(
      { ...f.key, route: "fans" },
      "fans",
      "human",
      [
        { path: ["flows", elementSubject(capturedWalk.nodes.find((node) => node.id === 8718801)!), "edit"], value: { value: { cfm: 250 } } },
        { path: ["parameters", "terminalFlow", "edit"], value: { value: "PE_M_Grd_AirFlow" } },
      ],
      0,
    );
    expect(staged.ok).toBe(true);
    const ducts = await f.saved.apply(
      f.key,
      "ducts",
      "human",
      [{ path: ["writeIntent", "edit"], value: { value: { groups: ["group:g1"] } } }],
      0,
    );
    expect(ducts.ok).toBe(true);
    const fans = (await f.saved.view({ ...f.key, route: "fans" }, "fans"))!.handle;
    const work = (await f.saved.view(f.key, "ducts"))!.handle;
    const source = catalog();
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === "/pe/capabilities") return Response.json(source);
      if (path === "/ops") return Response.json({ operations: [] });
      return path.startsWith("/pe/")
        ? f.api.fetch(request)
        : f.request(request, { kind: "pea", context: "context-t1", thread: "t1" });
    });
    const head: Head = {
      thread: "t1",
      revision: 1,
      targets: [{ request: { kind: "open", ref: f.target.ref }, admission: null }],
    };
    const discovery = (await run(peFind, { query: "sheet.plan", limit: 8 }, head)) as {
      matches: Array<{ key: string; description: string; input: unknown }>;
    };
    const row = discovery.matches.find((row) => row.key === "op:sheet.plan")!;
    // Slice 7: the sheet pair is every route's door; the handle names the route, so a Fans handle decodes too.
    expect(row.description).toContain("Work handle");
    expect(commands["sheet.plan"].input.safeParse({ work: fans }).success).toBe(true);
    const preview = await run(peDo, { key: row.key, input: { work }, timeoutSeconds: 5 }, head);
    expect(preview, JSON.stringify(preview)).toMatchObject({
      ok: true,
      result: { state: "succeeded", result: { previewOnly: true } },
    });
    expect(f.dispatched.some((row) => row.key === "ducts.apply.plan")).toBe(true);
    expect(f.dispatched.some((row) => row.key === "ducts.apply")).toBe(false);
  } finally {
    await f.close();
  }
});

test("an exact-open turn Target reads and writes route Work under its document's Address (E2E-J1)", async () => {
  // The browser keys Families Work by the Chat document's Address; a Pea read that dropped the
  // Address hit the Target-less key, found no Work, and reported "unknown route 'families'".
  fakeRuntimeHost("http://127.0.0.1:9");
  const projectA = "C:\\Models\\projectA.rvt";
  const routeCalls: URL[] = [];
  const historyBodies: unknown[] = [];
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
    if (url.pathname.endsWith("/history")) historyBodies.push(JSON.parse(String(init?.body)));
    return url.searchParams.get("target") === projectA
      ? Response.json({ route: "families", revision: 2, doc: {}, ok: true })
      : Response.json({ error: "unknown route 'families'" }, { status: 404 });
  });
  const open: Head = {
    ...turn,
    targets: [
      { request: { kind: "open", ref: { session: "b1", openId: "project-a" } }, admission: null },
    ],
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
        key: "route:families.edit",
        input: { patches: [{ path: ["intent"], value: "x" }] },
        expectedRevision: 2,
        timeoutSeconds: 30,
      },
      open,
    )) as { ok: boolean };
    expect(proposed.ok).toBe(true);
    expect(routeCalls.map((url) => url.searchParams.get("target"))).toEqual([projectA, projectA]);
    // Pea's undo is the journal verb on the same Work key, never a null edit.
    const undone = (await run(
      peDo,
      {
        key: "route:families.history",
        input: { direction: "undo" },
        expectedRevision: 3,
        timeoutSeconds: 30,
      },
      open,
    )) as { ok: boolean };
    expect(undone.ok).toBe(true);
    expect(routeCalls.at(-1)!.pathname).toBe("/pe/route-state/families/history");
    expect(routeCalls.at(-1)!.searchParams.get("target")).toBe(projectA);
    expect(historyBodies).toEqual([{ direction: "undo", expectedRevision: 3 }]);
    routeCalls.pop();

    // A Chat document that closed has no Address to key by: refuse, never read Target-less Work.
    const gone = (await run(
      peRead,
      { key: "route:families", timeoutSeconds: 30 },
      {
        ...open,
        targets: [
          { request: { kind: "open", ref: { session: "b1", openId: "closed" } }, admission: null },
        ],
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

test("a linked catalog route dispatches through its declared transport whatever its presentation kind", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const listed = catalog();
  // Presentation kind is display only: a catalog route labelled as an op still runs as its route (before S1, kind "op" threw in dispatch).
  listed.capabilities = listed.capabilities.map((row) =>
    row.key === "route:reads.value" ? { ...row, kind: "op" } : row,
  );
  const called: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/pe/capabilities") return Response.json(listed);
    called.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return Response.json({ rows: [] });
  });
  const done = (await run(peDo, { key: "route:reads.value", input: { read: "fans.roster", args: { target: { session: "b1", openId: "A" } }, subscription: "presentation-kind", generation: 0 }, timeoutSeconds: 30 })) as {
    ok: boolean;
    result: unknown;
  };
  expect(done).toMatchObject({ ok: true, result: { rows: [] } });
  expect(called).toHaveLength(1);
  expect(called[0]).toMatch(/reads\/value/);
});

test("ADR 0021: a thread with several targets refuses a call with no override; an override names one", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const dispatched: (string | null)[] = [];
  const work: URL[] = [];
  const workWrites: unknown[] = [];
  let connected = true;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/ops") return Response.json({ operations: [] });
    if (url.pathname.includes("/route-state/")) {
      work.push(url);
      if (typeof init?.body === "string") workWrites.push(JSON.parse(init.body));
      return Response.json({ ok: true, revision: 3, doc: {} });
    }
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (body.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "b1",
            connected,
            openDocuments: [
              { openId: "a", address: "C:\\Models\\A.rvt", isFamilyDocument: false },
              { openId: "b", address: "C:\\Models\\B.rvt", isFamilyDocument: false },
              { openId: "outside", address: "C:\\Models\\Other.rvt", isFamilyDocument: false },
            ],
          },
        ],
      });
    dispatched.push(new Headers(init?.headers).get("x-pe-open-document-id"));
    return Response.json({ done: true });
  });
  const head: Head = {
    thread: "t1",
    revision: 2,
    targets: ["a", "b"].map((openId) => ({
      request: { kind: "open" as const, ref: { session: "b1", openId } },
      admission: null,
    })),
  };
  try {
    const key = "op:revit.catalog.loaded-families";
    expect(await run(peRead, { key, timeoutSeconds: 30 }, head)).toMatchObject({
      ok: false,
      content: expect.stringContaining("several-targets"),
    });
    expect(
      await run(
        peRead,
        { key, timeoutSeconds: 30, target: { kind: "open", ref: { session: "b1", openId: "b" } } },
        head,
      ),
    ).toMatchObject({ ok: true, revision: 2 });
    expect(dispatched).toEqual(["b"]);
    const route = { key: "route:families", timeoutSeconds: 30 };
    expect(await run(peRead, route, head)).toMatchObject({
      ok: false,
      content: expect.stringContaining("several-targets"),
    });
    const target = { kind: "open", ref: { session: "b1", openId: "b" } };
    expect(await run(peRead, { ...route, target }, head)).toMatchObject({
      ok: true,
      target: { session: "b1", document: "C:\\Models\\B.rvt" },
    });
    expect(
      await run(
        peDo,
        {
          ...route,
          key: "route:families.edit",
          target,
          expectedRevision: 3,
          input: { patches: [{ path: ["scope", "suggestion"], value: {} }] },
        },
        head,
      ),
    ).toMatchObject({ ok: true, revision: 2 });
    expect(
      await run(
        peDo,
        {
          ...route,
          key: "route:families.edit",
          expectedRevision: 3,
          target: { kind: "open", ref: { session: "b1", openId: "outside" } },
        },
        head,
      ),
    ).toMatchObject({ ok: true });
    for (const openId of ["closed"]) {
      expect(
        await run(
          peDo,
          {
            ...route,
            key: "route:families.edit",
            expectedRevision: 3,
            target: { kind: "open", ref: { session: "b1", openId } },
          },
          head,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(await run(peRead, { ...route, target: { id: "sdk" } }, head)).toMatchObject({
      ok: false,
    });
    expect(
      work.map((url) => [url.searchParams.get("target"), url.searchParams.get("open")]),
    ).toEqual([
      ["C:\\Models\\B.rvt", "b1/b"],
      ["C:\\Models\\B.rvt", "b1/b"],
      ["C:\\Models\\Other.rvt", "b1/outside"],
    ]);
    expect(workWrites).toMatchObject([{ expectedRevision: 3 }, { expectedRevision: 3 }]);
    expect(head.targets.map((entry) => entry.request)).toEqual(
      ["a", "b"].map((openId) => ({ kind: "open", ref: { session: "b1", openId } })),
    );
    connected = false;
    expect(await run(peRead, { ...route, target }, head)).toMatchObject({
      ok: false,
      content: expect.stringContaining("disconnected"),
    });
    expect(work).toHaveLength(3);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("the live head names an open lifetime; reopen needs an explicit override and host/session work needs no Work", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  let openId = "a";
  const dispatches: Array<{ key: string; session: string | null; document: string | null }> = [];
  const source = catalog();
  source.capabilities.push(
    ...buildCapabilities({
      ops: [
        {
          subject: "None",
          touches: "Metadata",
          effect: "Read",
          cardinality: "One",
          costTier: "Cheap" as const,
          key: "host.status",
          needs: "nothing",
          intent: "Read",
        },
        {
          subject: "None",
          touches: "Metadata",
          effect: "Read",
          cardinality: "One",
          costTier: "Cheap" as const,
          key: "family.look",
          needs: "family-document",
          intent: "Read",
        },
        {
          subject: "None",
          touches: "Metadata",
          effect: "Read",
          cardinality: "One",
          costTier: "Cheap" as const,
          key: "revit.context.document-session",
          needs: "nothing",
          intent: "Read",
        },
      ],
      routes: [],
      packages: [],
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
      targets: [
        { request: { kind: "open", ref: { session: "b1", openId: "a" } }, admission: null },
      ],
      revision: 4,
    };
    const call = (input: unknown) => run(peRead, input, head);
    expect(
      await call({ key: "op:revit.catalog.loaded-families", timeoutSeconds: 30 }),
    ).toMatchObject({ ok: true, revision: 4 });
    expect(
      await call({
        key: "op:family.look",
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
        key: "op:family.look",
        timeoutSeconds: 30,
        target: { kind: "open", ref: { session: "b1", openId: "a2" } },
      }),
    ).toMatchObject({ ok: false, content: expect.stringContaining("wrong-document-kind") });
    expect(
      await peRead.execute!({ key: "op:host.status", timeoutSeconds: 30 } as never, {} as never),
    ).toMatchObject({ ok: true });
    expect(
      await peRead.execute!(
        {
          key: "op:revit.context.document-session",
          target: { id: "idle" },
          timeoutSeconds: 30,
        } as never,
        {} as never,
      ),
    ).toMatchObject({ ok: true });
    expect(dispatches.map(({ session, document }) => [session, document])).toEqual([
      ["b1", "a"],
      ["b1", "family"],
      ["b1", "a"],
      ["b1", "a2"],
      [null, null],
      [null, null],
    ]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("Pea dispatches roster and sheet through the registered read door without an analysis read", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const target = { session: "s1", openId: "open-1" };
  let fail = false;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
    if (path === "/pe/capabilities") return Response.json(catalog());
    const request = JSON.parse(init?.body as string);
    if (path === "/pe/reads/value" && request.read === "fans.roster") {
      expect(request).toEqual({ read: "fans.roster", args: { target }, subscription: "pea-roster", generation: 0 });
      return Response.json({ target, rows: [] });
    }
    if (path === "/pe/reads/value" && request.read === "ducts.sheet") {
      expect(request).toMatchObject({ read: "ducts.sheet", subscription: "pea-sheet", generation: 0, args: {
        target,
        mode: "fan",
        unitId: 14577391,
        portIndex: 2,
      } });
      if (fail) return Response.json({ error: "Stale sheet basis" }, { status: 409 });
      return Response.json({ target, kind: "overview", mode: "fan", basis: "observation" });
    }
    throw Error(`Unexpected guide request ${path}`);
  });
  expect(
    await run(peRead, { key: "route:reads.value", input: { read: "fans.roster", args: { target }, subscription: "pea-roster", generation: 0 }, timeoutSeconds: 30 }),
  ).toMatchObject({
    ok: true,
    target: { session: "s1", document: "open-1" },
    result: { rows: [] },
  });
  const input = { read: "ducts.sheet", args: { target, mode: "fan", unitId: 14577391, portIndex: 2 }, subscription: "pea-sheet", generation: 0 };
  expect(await run(peRead, { key: "route:reads.value", input, timeoutSeconds: 30 })).toMatchObject({
    ok: true,
    result: { kind: "overview", basis: "observation" },
  });
  fail = true;
  expect(await run(peRead, { key: "route:reads.value", input, timeoutSeconds: 30 })).toMatchObject({
    ok: false,
  });
});

test("route:ducts.set-view with no mounted view opens only through an explicit command and ignores an older lease", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const opens: unknown[] = [];
  const sets: unknown[] = [];
  let mounted = false;
  let visible = true;
  let reads = 0;
  const commandId = "6f1c2a9e-4b7d-4c3e-9a1f-2d8e5b7c0a22";
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/pe/capabilities") return Response.json(catalog());
    if (url.pathname === "/pe/route-view/ducts/open") {
      opens.push(JSON.parse(init!.body as string));
      mounted = visible;
      return Response.json({ ok: true, commandId });
    }
    if (url.pathname === "/pe/route-view/ducts" && method === "GET")
      return mounted
        ? Response.json({
            instance: "6f1c2a9e-4b7d-4c3e-9a1f-2d8e5b7c0a11",
            revision: 3,
            openCommandId: reads++ ? commandId : "an-older-command",
            route: "ducts",
            thread: "t1",
            page: { system: "" },
            facts: { systems: [{ name: "SA 19" }], levels: [] },
          })
        : Response.json(
            { ok: false, error: "no mounted ducts view", instances: [] },
            { status: 409 },
          );
    if (url.pathname === "/pe/route-view/ducts/set") {
      sets.push(JSON.parse(init!.body as string));
      return Response.json({ ok: true, context: {} });
    }
    throw Error(`unexpected ${method} ${url.pathname}`);
  });
  const result = await run(peDo, {
    key: "route:ducts.set-view",
    input: { system: "sa 19" },
    timeoutSeconds: 30,
  });
  // The host builds the link from the registered identity; MCP carries only thread and target.
  expect(opens).toMatchObject([{ thread: "t1" }]);
  expect(opens[0]).not.toHaveProperty("link");
  expect(reads).toBeGreaterThanOrEqual(2);
  // Transport-only fixture: MCP preserves casing and uses the acquired lease revision.
  // pea-casing.test.tsx drives name resolution through the actual mounted typed owner and its ack.
  expect(sets).toMatchObject([
    {
      thread: "t1",
      instance: "6f1c2a9e-4b7d-4c3e-9a1f-2d8e5b7c0a11",
      revision: 3,
      patch: { system: "sa 19" },
    },
  ]);
  expect(result).toMatchObject({ ok: true });

  sets.length = 0;
  expect(
    await run(peDo, {
      key: "route:ducts.set-view",
      timeoutSeconds: 30,
      input: { instance: "6f1c2a9e-4b7d-4c3e-9a1f-2d8e5b7c0a11", revision: 1, system: "SA 19" },
    }),
  ).toMatchObject({ ok: true });
  expect(sets).toMatchObject([{ revision: 1 }]); // The host fences the caller's revision, never a refreshed one.
  sets.length = 0;
  expect(
    await run(peDo, {
      key: "route:ducts.set-view",
      timeoutSeconds: 30,
      input: { revision: 1, system: "SA 19" },
    }),
  ).toMatchObject({ ok: false, content: expect.stringContaining("both instance and revision") });
  expect(sets).toEqual([]);

  // No browser acquired this explicit command: an old or absent lease cannot claim success.
  opens.length = 0;
  sets.length = 0;
  mounted = false;
  visible = false;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const pending = run(peDo, {
      key: "route:ducts.set-view",
      input: { system: "SA 19" },
      timeoutSeconds: 30,
    });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      result: { mounted: false, outcome: "unmounted", applied: false },
    });
  } finally {
    vi.useRealTimers();
  }
  expect(opens).toHaveLength(1);
  expect(sets).toEqual([]);
});

test("person-only admin routes expose no Page fields in builtin or admitted capability discovery", () => {
  for (const admitted of [[], [bindGraph, opsGraph]]) {
    const rows = buildCapabilities({
      ops: [], routes: [], packages: [], skills: [],
      admittedRoutes: () => admitted.map(graph => {
        const data = RouteGraphJson.parse(graph);
        return { key: data.key, title: data.name, address: data.address, fields: data.fields };
      }),
    });
    for (const key of ["bind", "ops"]) {
      expect(rows.filter(row => row.key.startsWith(`route:${key}.`))).toEqual([]);
    }
    expect(rows.some(row => row.key === "route:ducts.set-view")).toBe(true);
  }
});

test("an admitted route's view rows project keys from its agent policy, never the legacy codec", () => {
  const admitted = {
    fan: { role: "subject", agent: "set" },
    viewport: { role: "pose", agent: "read" },
    notes: { role: "pose", agent: "none" },
  } as never;
  const rows = buildCapabilities({
    ops: [],
    routes: [],
    packages: [],
    skills: [],
    admittedRoutes: () => [{ key: "fans", title: "Fans", address: "/fans", fields: admitted }],
  });
  const view = rows.find((row) => row.key === "route:fans.view")!;
  expect(view.description).toContain("its keys (fan, viewport; settable: fan)");
  const set = rows.find((row) => row.key === "route:fans.set-view")!;
  expect(JSON.stringify(set.input)).toContain('"fan":{"type":"string"}');
  expect(JSON.stringify(set.input)).not.toContain('"viewport"');
  // A legacy route keeps its own lease projection.
  expect(rows.find((row) => row.key === "route:ducts.view")!.description).not.toContain("settable: fan)");
});
