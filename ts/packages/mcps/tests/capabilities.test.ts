import { normalizePeError } from "@pe/host-contracts/pe-api";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { join } from "node:path";
import { checkoutRootFrom } from "@pe/host-contracts/service-identity";
import { DUCTS_GUIDE } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  address,
  documentRows,
  type CapabilityCatalog,
  type ThreadHead,
  emptyThreadHead,
} from "@pe/agent-contracts";
import { buildCapabilities, createCapabilityCatalogSource } from "../src/pea/capabilities.ts";
import { createRouteRegistrations } from "../src/pea/routes.ts";
import { bundledPeaSkills } from "../src/pea/skills.ts";
import { skillSnapshot } from "../src/pea/skill-publication.ts";
import type { PackageProjection } from "@pe/agent-contracts";
import { peDo, peFind, peRead } from "../src/pea/capability-tools.ts";

import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
      entrypoints: [{ sourcePath: "src/Rename.cs", name: "Rename sheets" }],
      members: [],
      contributions: [
        {
          kind: "script",
          path: "src/Rename.cs",
          memberPath: "src/Rename.cs",
          key: "script:@sheets/src/Rename.cs",
          name: "Rename sheets",
          description: null,
        },
      ],
      diagnostics: [],
    },
    {
      id: "broken",
      name: "Broken",
      version: "0.1.0",
      folder: "broken",
      entrypoints: [{ sourcePath: "src/Run.cs" }],
      members: [],
      contributions: [],
      diagnostics: [{ code: "Manifest", path: "pod.json", severity: "error", message: "bad json" }],
    },
  ],
  unreadable: [],
} satisfies PodList;

const fixtureHash = "a".repeat(64);
const packages: PackageProjection[] = pods.pods.map((p) => ({
  id: p.id,
  folder: p.folder,
  diagnostics: p.diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    path: d.path ?? undefined,
  })),
  members: p.contributions.map((c) => ({ path: c.memberPath, sha256: fixtureHash, sizeBytes: 1 })),
  contributions: p.contributions.map((c) => ({
    key: c.key,
    sourcePath: c.memberPath,
    title: `${p.name}: ${c.name}`,
    description: c.description ?? "",
  })),
}));
const admittedSkills = bundledPeaSkills.map((s) => {
  const bytes = Buffer.from(`${s.content.trimEnd()}\n`);
  return skillSnapshot("product", s.name, [
    { path: "SKILL.md", bytes, sha256: createHash("sha256").update(bytes).digest("hex") },
  ]);
});

function catalog(): CapabilityCatalog {
  return {
    at: "2026-09-04T00:00:00.000Z",
    machine: machineFixture([{ session: "b1", documents: null }]),
    sources: { catalog: "ok" },
    diagnostics: [],
    capabilities: buildCapabilities({
      ops,
      routes: createRouteRegistrations({ hostBaseUrl: "http://127.0.0.1:9" }).map(
        (registration) => registration.spec,
      ),
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
      ...emptyThreadHead,
      revision: 7,
      defaultTarget: { kind: "open", ref: user },
      grant: {
        lifetime: user,
        grantedAt: new Date().toISOString(),
        grantedVia: "local",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revoked: null,
      },
    };
    bindControl({
      acquired: (ref) => (ref.session === "pea" ? "acq-copy" : null),
      acquiredSession: (session) => (session === "pea" ? "acq-pea" : null),
      heads: () => head,
    });
    const nativeOps = [
      ...ops,
      { key: "revit.context.view-image", intent: "Read" as const, needs: "document" as const },
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
    const writes: Array<{ caller: unknown; destination: unknown; basis: unknown }> = [];
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
                { view: { label: "User view" }, byteSize: image.length, pixelSize: 1500 },
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
            const basis = admitCrossing(identity.caller, admission.destination, "/actions");
            writes.push({ caller: identity.caller, destination: admission.destination, basis });
            const row = {
              ...admission,
              caller: identity.caller,
              basis,
              request: input,
              state: "succeeded",
              result: { status: "Succeeded" },
              steps: [],
              preparation: { state: "unprepared" },
              recovery: [],
              publication: { state: "unrequested" },
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
      const moved = await call("target_set", { defaultTarget: { kind: "open", ref: user } });
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
      // Chat keeps the head default, permits that grant and Pea detours, and refuses another user lifetime.
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
      expect(JSON.stringify(await chatCall(other))).toContain("grant.other-lifetime");
      expect(
        JSON.parse(((await chatCall()).content as Array<{ text: string }>)[0]!.text),
      ).toMatchObject({ ok: true, revision: 7 });
      expect(
        JSON.parse(((await chatCall(own)).content as Array<{ text: string }>)[0]!.text),
      ).toMatchObject({ ok: true });
      expect(head.defaultTarget).toEqual({ kind: "open", ref: user });
      expect(writes[0]).toMatchObject({ basis: { kind: "grant", thread: "chat", lifetime: user } });
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
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/ops") {
      opsReads += 1;
      return Response.json({ operations: ops });
    }
    const key = JSON.parse(typeof init?.body === "string" ? init.body : "{}").key;
    return Response.json(
      key === "pod.list"
        ? pods
        : { sessions: [{ sessionId: "b1", connected: true, openDocuments: open }] },
    );
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

test("F-H6-3: plan and capture over loaded families are human verbs; Pea never finds or runs them", async () => {
  const rows = catalog().capabilities;
  const verbs = ["families.plan", "families.capture"].flatMap((key) => [
    `op:${key}`,
    `workflow:${key}`,
  ]);
  for (const key of verbs)
    expect(rows.find((row) => row.key === key)?.principal).toEqual(["human"]);
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubGlobal("fetch", async () => Response.json(catalog()));
  try {
    const found = (await run(peFind, { query: "plan capture loaded families", limit: 50 })) as {
      matches: Array<{ key: string }>;
    };
    expect(found.matches.length).toBeGreaterThan(0);
    for (const key of verbs) expect(found.matches.map((row) => row.key)).not.toContain(key);
    const map = (await run(peFind, {})) as { map: { total: number } };
    expect(map.map.total).toBe(rows.filter((row) => row.principal.includes("pea")).length);
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

type ExecutableTool = { execute?: (input: never, context: never) => Promise<unknown> };
type Head = ThreadHead & { thread: string };
const turn: Head = {
  ...emptyThreadHead,
  thread: "t1",
  defaultTarget: { kind: "named", session: "b1", address: address("C:\\Models\\A.rvt") },
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

test("an exact-open turn Target reads and writes route Work under its document's Address (E2E-J1)", async () => {
  // The browser keys Families Work by the Chat document's Address; a Pea read that dropped the
  // Address hit the Target-less key, found no Work, and reported "unknown route 'families'".
  fakeRuntimeHost("http://127.0.0.1:9");
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

test("the live head names an open lifetime; reopen needs an explicit override and host/session work needs no Work", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
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
      ...emptyThreadHead,
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
test("route:ducts.guide is one read row and answers without a document or a host read", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const rows = catalog().capabilities.filter((row) => row.key === "route:ducts.guide");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "route-doc", needs: "nothing", mutates: false });
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
    calls.push(path);
    if (path === "/pe/capabilities") return Response.json(catalog());
    throw Error(`Unexpected guide request ${path}`);
  });
  const read = (await run(peRead, { key: "route:ducts.guide", timeoutSeconds: 30 })) as {
    ok: boolean;
    result: { guide: { summary: string; cases: Record<string, unknown>[] }; present?: unknown };
  };
  expect(read.ok).toBe(true);
  expect(read.result.guide.summary).toBe(DUCTS_GUIDE.summary);
  expect(read.result.guide.cases).toHaveLength(DUCTS_GUIDE.cases.length);
  expect(Object.keys(read.result.guide.cases[0]!).sort()).toEqual(
    ["code", "group", "kinds", "number", "status", "title"].sort(),
  );
  expect(read.result).not.toHaveProperty("present");
  expect(calls).toEqual(["/pe/capabilities"]);
});

test("route:ducts.guide with a document adds the cases its fresh analysis shows, or says why not", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const document = { session: "s1", openId: "open-1" };
  const kase = DUCTS_GUIDE.cases.find((c) => c.kinds.length)!;
  const [kind, grade = null] = kase.kinds[0]!.split(":");
  let fail = false;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(url instanceof Request ? url.url : String(url)).pathname;
    if (path === "/pe/capabilities") return Response.json(catalog());
    if (path === "/pe/ducts/analysis") {
      expect(JSON.parse(init?.body as string)).toMatchObject({
        source: { kind: "fresh", target: document },
        selector: { kind: "document" },
        projection: "summary",
        limit: 1,
      });
      if (fail) return Response.json({ error: "no such document" }, { status: 404 });
      return Response.json({
        target: document,
        findings: [{ kind, grade, elementIds: [7, 8] }],
        findingCounts: { byKindAndGrade: { [kase.kinds[0]!]: 1 } },
      });
    }
    throw Error(`Unexpected guide request ${path}`);
  });
  const input = { document, section: "limits" };
  expect(await run(peRead, { key: "route:ducts.guide", input, timeoutSeconds: 30 })).toMatchObject({
    ok: true,
    target: { session: "s1", document: "open-1" },
    result: {
      guide: { limits: DUCTS_GUIDE.limits },
      present: expect.arrayContaining([
        { number: kase.number, title: kase.title, code: kase.code, count: 1, elementIds: [7, 8] },
      ]),
    },
  });
  fail = true;
  expect(await run(peRead, { key: "route:ducts.guide", input, timeoutSeconds: 30 })).toMatchObject({
    ok: true,
    result: {
      guide: { limits: DUCTS_GUIDE.limits },
      present: null,
      presentError: expect.stringContaining("no such document"),
    },
  });
});
