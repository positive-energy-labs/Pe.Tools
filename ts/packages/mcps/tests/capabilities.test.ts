import { normalizePeError } from "@pe/host-contracts/pe-api";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
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
  documentRows,
  findCapabilities,
  recentRows,
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

import { bodyText } from "./body-text.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { contextFetch, withInvocationContext } from "../src/shared/invocation-context.ts";
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

test("Page shelf reads state and pins through the binding door without borrowing Page authority", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/pe/capabilities")
      return Response.json({
        ...catalog(),
        capabilities: [
          ...catalog().capabilities,
          ...[
            ["page:@pages/ducts", "/pages/ducts/", "pages", "ducts/index.html"],
            ["page:@ducts/pages/check", "/pages/ducts--check/", "ducts", "pages/check/index.html"],
          ].map(([key, openUrl, id, sourcePath]) => ({
            key,
            kind: "page",
            title: "Ducts",
            description: "Page",
            needs: "nothing",
            mutates: false,
            actor: "any",
            input: {},
            source: "pages",
            rank: 1,
            package: { id, path: sourcePath, sha256: fixtureHash },
            projection: { openUrl, pane: "page" },
          })),
        ],
      });
    return Response.json(
      path.endsWith("binding")
        ? { refusal: { code: "page.binding-not-yours" } }
        : { page: "page:@pages/ducts", text: "Duct checks" },
      { status: path.endsWith("binding") ? 403 : 200 },
    );
  });
  const read = await run(peRead, { key: "page:@pages/ducts", timeoutSeconds: 30 });
  expect(read).toMatchObject({ ok: true, result: { state: { text: "Duct checks" } } });
  const bound = await run(peDo, {
    key: "page:@pages/ducts",
    input: { binding: { kind: "pinned", address: "C:/Ducts.rvt" } },
    timeoutSeconds: 30,
  });
  expect(bound).toMatchObject({
    ok: false,
    result: { refusal: { code: "page.binding-not-yours" } },
  });
  expect(calls.at(-1)).toEqual({
    path: "/pe/pages/ducts/binding",
    method: "PUT",
    body: { kind: "pinned", address: "C:/Ducts.rvt" },
  });
  await run(peDo, {
    key: "page:@ducts/pages/check",
    input: { event: { kind: "checked", text: "Duct checks" } },
    timeoutSeconds: 30,
  });
  expect(calls.at(-1)).toEqual({
    path: "/pages/ducts--check/events",
    method: "POST",
    body: { kind: "checked", text: "Duct checks" },
  });
  expect(calls.some((call) => /\/(act|call)$/.test(call.path))).toBe(false);
});

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
  "F-a %s: an MCP-only client reads user documents, refuses their writes, and writes Pea lifetimes",
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
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({
        ok: true,
      });
      expect(writes).toEqual([
        {
          caller: expect.objectContaining({
            kind: "external-mcp",
            label: transport === "stdio" ? "pea-stdio" : "f-a",
          }),
          destination: { kind: "document", ref: own },
          basis: {
            kind: "acquisition",
            id: "acq-copy",
            scope: { kind: "document", lifetime: own },
          },
        },
      ]);
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
      expect(writes[1]).toMatchObject({ basis: { kind: "grant", thread: "chat", lifetime: user } });
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

test("native catalog survives SDK latency while host-only sources keep their short deadlines", async () => {
  fakeRuntimeHost("http://127.0.0.1:19");
  vi.useFakeTimers();
  const deadlines: number[] = [];
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    deadlines.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("source timed out")), ms);
    return controller.signal;
  });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/ops")
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ operations: ops })), 3187);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        });
      });
    if (url.pathname === "/instances/readings") return Response.json({ result: { recents: [] } });
    expect(url.pathname).toBe("/call");
    const key = JSON.parse(typeof init?.body === "string" ? init.body : "{}").key;
    return Response.json(key === "pod.list" ? pods : { sessions: [] });
  });
  try {
    const source = createCapabilityCatalogSource({
      machine: async () => machineFixture(),
      hostBaseUrl: "http://127.0.0.1:19",
      registrations: [],
    });
    const reading = source.read();
    await vi.advanceTimersByTimeAsync(3187);
    const result = await reading;
    expect(result.sources.catalog).toBe("ok");
    expect(result.capabilities.some((row) => row.key === "op:scripting.execute")).toBe(true);
    expect(deadlines.filter((ms) => ms === 2000)).toHaveLength(0);
    expect(deadlines.some((ms) => ms > 30_000)).toBe(true);
  } finally {
    timeout.mockRestore();
    vi.useRealTimers();
  }
});

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

test("a new catalog scope reads the content owner's current snapshot without a second TTL", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ operations: [], result: { recents: [] } }));
  let revision = "first";
  const source = createCapabilityCatalogSource({
    machine: async () => machineFixture(),
    hostBaseUrl: "http://127.0.0.1:19",
    registrations: [],
    content: async () => ({
      packages: [],
      skills: [],
      diagnostics: [],
      sourceDiagnostics: [revision],
    }),
  });
  expect((await source.read({ bridgeSessionId: "one" })).sources.packages).toBe("first");
  revision = "second";
  expect((await source.read({ bridgeSessionId: "two" })).sources.packages).toBe("second");
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
    packages: [],
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
  fakeRuntimeHost("http://127.0.0.1:9");
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
    "workflow:instances.open",
    "workflow:instances.start",
    "workflow:instances.stop",
    "route:pods",
    "script:@sheets/src/Rename.cs",
    "skill:@product/skills/build-pod",
  ])
    expect(keys).toContain(key);
  for (const route of ["families", "parameter-links", "takeoffs"])
    expect(keys).toContain(`route:${route}.propose`);
  // Instances is a launch, not authored Work: nothing to read or propose (ADR 0016).
  expect(keys).not.toContain("route:instances");
  expect(keys).not.toContain("route:instances.propose");
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
    "script",
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
  expect((await find({ query: "rename sheets" })).matches[0]?.key).toBe(
    "script:@sheets/src/Rename.cs",
  );
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
  fakeRuntimeHost("http://127.0.0.1:9");
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
  fakeRuntimeHost("http://127.0.0.1:9");
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
  fakeRuntimeHost("http://127.0.0.1:9");
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
    fakeRuntimeHost(`http://127.0.0.1:${port}`);
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

test("Families view Pea doors require a mounted pane and return an exact retained reference", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
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
  fakeRuntimeHost("http://127.0.0.1:9");
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

test("an open document is a doc: row: pe_find finds it, pe_read returns its mention, pe_do refuses", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  // What GET /pe/capabilities serves: the catalog plus its sessions' open documents as rows.
  const base = catalog();
  base.machine = machineFixture([
    {
      session: "b1",
      documents: [
        {
          openId: "o1",
          address: "C:\\Models\\Riser.rvt",
          title: "Mechanical Riser",
          isFamilyDocument: false,
          isActive: true,
        },
      ],
    },
  ]);
  const served = { ...base, capabilities: [...base.capabilities, ...documentRows(base)] };
  vi.stubGlobal("fetch", async () => Response.json(served));
  const found = (await run(peFind, { query: "mechanical riser" })) as {
    matches: Array<{ key: string; kind: string; title: string }>;
  };
  expect(found.matches[0]).toMatchObject({
    key: "doc:b1/o1",
    kind: "document",
    title: "Mechanical Riser",
  });
  const read = (await run(peRead, { key: "doc:b1/o1", timeoutSeconds: 30 })) as {
    ok: boolean;
    kind: string;
    result: unknown;
  };
  expect(read).toMatchObject({ ok: true, kind: "document" });
  expect(read.result).toEqual({
    key: "doc:b1/o1",
    kind: "document",
    title: "Mechanical Riser",
    takenAt: served.at,
    facts: {
      session: "b1",
      openId: "o1",
      address: "C:\\Models\\Riser.rvt",
      family: false,
      active: true,
      revit: "2025",
      custody: "controlled",
    },
  });
  const done = (await run(peDo, { key: "doc:b1/o1", timeoutSeconds: 30 })) as {
    isError: boolean;
    content: string;
  };
  expect(done.isError).toBe(true);
  expect(done.content).toContain("a pointer and not an action");
});

test("a recent document is a recent: row: pe_find finds it, pe_read returns its mention with openWith, pe_do refuses", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const base = catalog();
  base.recents = [
    {
      title: "Belmont Plant",
      path: "C:\\Jobs\\Belmont Plant.rvt",
      isCloud: false,
      region: null,
      projectGuid: null,
      modelGuid: null,
      year: 2024,
      savedYear: 2024,
      rank: 1,
    },
  ];
  const served = { ...base, capabilities: [...base.capabilities, ...recentRows(base)] };
  vi.stubGlobal("fetch", async () => Response.json(served));
  const key = "recent:C:\\Jobs\\Belmont Plant.rvt";
  const found = (await run(peFind, { query: "belmont plant" })) as {
    matches: Array<{ key: string; kind: string }>;
  };
  expect(found.matches[0]).toMatchObject({ key, kind: "recent" });
  const read = (await run(peRead, { key, timeoutSeconds: 30 })) as {
    ok: boolean;
    kind: string;
    result: { facts: Record<string, unknown> };
  };
  expect(read).toMatchObject({ ok: true, kind: "recent" });
  expect(read.result.facts).toMatchObject({
    path: "C:\\Jobs\\Belmont Plant.rvt",
    year: 2024,
    open: null,
    openWith: "C:\\Jobs\\Belmont Plant.rvt",
  });
  const done = (await run(peDo, { key, timeoutSeconds: 30 })) as {
    isError: boolean;
    content: string;
  };
  expect(done.isError).toBe(true);
  expect(done.content).toContain("is a recent document, a pointer");
  expect(done.content).toContain("workflow:instances.open");
  expect(done.content).not.toContain("propose");
});

test("recents ride the catalog from the host's SDK reading: cached, never awaited past their budget, a failure is a source", async () => {
  fakeRuntimeHost("http://127.0.0.1:19");
  const recent = {
    title: "Plant",
    path: "C:\\Jobs\\Plant.rvt",
    isCloud: false,
    region: null,
    projectGuid: null,
    modelGuid: null,
    year: 2025,
    savedYear: 2025,
    savedYearFailure: null,
    rank: 1,
  };
  let recentsReads = 0;
  let answer: () => Promise<Response> = async () =>
    Response.json({ result: { state: "ok", recents: [recent], sources: [] } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/instances/readings") {
      expect(url.searchParams.get("read")).toBe("recents");
      recentsReads += 1;
      return answer();
    }
    if (url.pathname === "/ops") return Response.json({ operations: ops });
    const key = JSON.parse(typeof init?.body === "string" ? init.body : "{}").key;
    return Response.json(key === "pod.list" ? pods : { sessions: [] });
  });
  const source = createCapabilityCatalogSource({
    machine: async () => machineFixture(),
    hostBaseUrl: "http://127.0.0.1:19",
    registrations: [],
  });
  const first = await source.read();
  expect(first.sources.recents).toBe("ok");
  expect(recentRows(first).map((row) => row.key)).toEqual(["recent:C:\\Jobs\\Plant.rvt"]);
  await source.read({ bridgeSessionId: "other" });
  expect(recentsReads).toBe(1);

  // A slow read: the catalog answers at the budget without them; the next read has them.
  vi.useFakeTimers();
  try {
    const slow = createCapabilityCatalogSource({
      machine: async () => machineFixture(),
      hostBaseUrl: "http://127.0.0.1:19",
      registrations: [],
    });
    answer = () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve(Response.json({ result: { state: "ok", recents: [recent], sources: [] } })),
          5_000,
        ),
      );
    const reading = slow.read();
    await vi.advanceTimersByTimeAsync(2_000);
    const early = await reading;
    expect(early.recents).toEqual([]);
    expect(early.sources.recents).toMatch(/^still reading/);
    expect(early.capabilities.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await slow.read()).recents).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }

  // A failure names itself in sources; the rest of the catalog stands.
  answer = async () => Response.json({ error: "pe-revit missing" }, { status: 503 });
  const failing = createCapabilityCatalogSource({
    machine: async () => machineFixture(),
    hostBaseUrl: "http://127.0.0.1:19",
    registrations: [],
  });
  const failed = await failing.read();
  expect(failed.sources.recents).toMatch(/^did not answer: .*503/);
  expect(failed.recents).toEqual([]);
  expect(failed.sources.catalog).toBe("ok");
});

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

test("an explicit document detour leaves the next call on the thread head default", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
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

test("the doors ride the host under the turn Target and name the revision and resolved target", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
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
    if (url.pathname === "/pe/contributions") {
      const skill = admittedSkills.find((s) => s.key === url.searchParams.get("key"));
      return Response.json(
        skill
          ? {
              content: skill.content,
              bytesBase64: Buffer.from(skill.content).toString("base64"),
              sha256: skill.package.sha256,
            }
          : {
              content: "script",
              bytesBase64: "c2NyaXB0",
              sha256: fixtureHash,
              folder: "sheets",
              sourceBundle: {
                files: [
                  {
                    path: "pod.json",
                    bytesBase64: Buffer.from(JSON.stringify({ id: "sheets" })).toString("base64"),
                  },
                  { path: "src/Rename.cs", bytesBase64: "c2NyaXB0" },
                ],
              },
            },
      );
    }
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
        caller: { kind: "pea", context: "c", thread: "t1" },
        basis: null,
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
    return Response.json({ ok: true, revision: 3 });
  });
  try {
    const map = (await run(peFind, {})) as {
      map: { total: number };
      machine: { revit: { sessions: unknown[] } };
      revision: number;
    };
    expect(map.map.total).toBeGreaterThan(10);
    expect(map.machine.revit.sessions).toHaveLength(1);
    expect(map.revision).toBe(4);
    // The catalog is read for the turn's Target Address, never for a model-typed selector.
    expect(calls[0]?.url.search).toBe("?target=C%3A%5CModels%5CA.rvt&session=b1");

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

    // SDK observations are a host reading, never authored Work: no route command, no revision.
    const reading = (await run(peRead, {
      key: "op:instances.read",
      input: { read: "sessions" },
      timeoutSeconds: 30,
    })) as { ok: boolean };
    expect(reading.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/instances/readings");
    expect(calls.at(-1)?.url.search).toBe("?read=sessions");

    const pod = (await run(peDo, { key: "script:@sheets/src/Rename.cs", timeoutSeconds: 30 })) as {
      ok: boolean;
    };
    expect(pod.ok).toBe(true);
    expect(calls.at(-1)?.url.pathname).toBe("/actions");
    expect(calls.at(-1)?.body).toMatchObject({
      kind: "operation",
      key: "scripting.execute",
      input: { sourcePath: "src/Rename.cs", workspaceKey: "sheets" },
    });
    expect(calls.at(-1)?.body).not.toHaveProperty("actor");

    const human = (await run(peDo, {
      key: "workflow:takeoffs.initialize",
      timeoutSeconds: 30,
    })) as {
      isError: boolean;
      content: string;
    };
    expect(human.isError).toBe(true);
    expect(human.content).toContain("human-only");

    const skill = (await run(peRead, {
      key: "skill:@product/skills/build-pod",
      timeoutSeconds: 30,
    })) as {
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
  fakeRuntimeHost("http://127.0.0.1:9");
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
        `/pe/route-state/${route === "family" ? "pods" : "families"}/apply`,
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
