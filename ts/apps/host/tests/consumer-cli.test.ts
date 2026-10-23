import { test, expect, vi } from "vite-plus/test";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { runPeaMain } from "../../pea/src/cli.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { opsCatalogRoute } from "../src/ops-catalog.ts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { hostOpCatalog } from "@pe/host-contracts/generated";
import { createCapabilityCatalogSource } from "@pe/mcps";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { fakeRuntimeHost } from "../../../packages/mcps/tests/runtime-host-fixture.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { callerOf, writeTerminalContext } from "../src/control.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { resolveLaneAndRoot } from "@pe/mcps";

test("missing or ambiguous bridge keeps generated discovery metadata and reports availability separately", async () => {
  const sdk = vi.fn(async () => {
    throw new Error("SDK discovery should not run without a bridge attachment");
  });
  const invoke = vi.fn(() => Effect.die("native catalog should not run"));
  let attachments: unknown[] = [];
  const bridge = {
    list: Effect.sync(() => attachments),
    invoke,
  } as unknown as RevitBridge["Service"];
  const web = HttpRouter.toWebHandler(
    opsCatalogRoute(() => Effect.die("not navigation"), sdk).pipe(
      Layer.provideMerge(Layer.succeed(RevitBridge, bridge)),
    ),
    { disableLogger: true },
  );
  try {
    const response = await web.handler(new Request("http://host/ops"), Context.empty() as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      operations: [
        ...hostOpCatalog.filter((op) => !isTsOnlyOperationKey(op.key)),
        ...tsOnlyOperationCatalog,
      ],
      bridgeCatalogError: "No Revit session is connected to the bridge.",
    });
    expect(sdk).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    // The agent's actual catalog projection retains schemas, document needs and human-only actors.
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.pathname === "/ops"
        ? web.handler(new Request(url), Context.empty() as never)
        : Response.json({ result: { recents: [] } });
    });
    const source = createCapabilityCatalogSource({
      hostBaseUrl: "http://host",
      registrations: [],
      machine: async () => machineFixture(),
    });
    const catalog = await source.read();
    expect(catalog.bridgeSessionId).toBeUndefined();
    expect(catalog.sources.catalog).toContain("bridge catalog unavailable");
    expect(
      catalog.capabilities.find((op) => op.key === "op:revit.catalog.loaded-families"),
    ).toMatchObject({
      needs: "document",
      mutates: false,
      input: { type: "object" },
    });
    expect(catalog.capabilities.find((op) => op.key === "op:families.plan")).toMatchObject({
      principal: ["human"],
    });
    for (const op of tsOnlyOperationCatalog)
      expect(body.operations.filter((row: { key: string }) => row.key === op.key)).toEqual([op]);

    // A nonempty attachment inventory enters SDK resolution. Its ambiguity is not catalog absence.
    attachments = [{ sessionId: "one" }, { sessionId: "two" }];
    sdk.mockRejectedValueOnce(Error("Several Revit sessions match; select one."));
    source.invalidate();
    const ambiguous = await source.read();
    expect(ambiguous.sources.catalog).toContain("Several Revit sessions match");
    expect(ambiguous.capabilities).toEqual(catalog.capabilities);
    expect(ambiguous.bridgeSessionId).toBeUndefined();
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    await web.dispose();
  }
});

// Only native execution and SDK inventory are substituted. Gunshi, HTTP, admission,
// durable steps, catalogue, local file/stdin decoding and original-ID replay are real.
test("actual pea/Gunshi argv crosses local HTTP: actor/id/openId, file/stdin A/B/A, raw partial reply and lost response replay without catalogue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pea-cli-owner-"));
  const journal = join(dir, "actions.json");
  let owner = new ActionJournal(journal),
    gone = false,
    lose = true;
  const effects: {
    key: string;
    input: unknown;
    session?: string;
    openId?: string | null;
    id?: string;
  }[] = [];
  const partial = {
    status: "Succeeded",
    executionId: "native-original",
    revitVersion: "mock",
    output: "one item failed",
    data: { succeeded: [1], failed: [{ id: 2, message: "refused" }] },
  };
  const operations = [
    {
      key: "scripting.execute",
      intent: "Mutate",
      needs: "document",
      requestSchemaJson: JSON.stringify({
        type: "object",
        required: ["scriptContent"],
        properties: { scriptContent: { type: "string" }, workspaceKey: { type: "string" } },
        additionalProperties: false,
      }),
    },
  ];
  const bridge = {
    list: Effect.sync(() =>
      gone
        ? []
        : ["A", "B"].map((sessionId) => ({
            sessionId,
            connected: true,
            lane: hostOwnership.lane,
            sourceRoot: hostOwnership.sourceRoot,
            serviceName: hostOwnership.serviceName,
            processId: sessionId === "A" ? 42 : 43,
            processStartUtcUnixMs: 1000,
            state: {
              openDocuments: [
                {
                  openId: `open-${sessionId}`,
                  address: `C:/${sessionId}.rvt`,
                  isFamilyDocument: false,
                },
              ],
            },
          })),
    ),
    invoke: (key: string, input: unknown, session?: string, openId?: string | null, id?: string) =>
      Effect.promise(async () => {
        if (gone) throw Error("session/catalogue gone");
        if (key === "host.ops.catalog") {
          expect(openId).toBeNull();
          return { value: { operations }, target: null };
        }
        effects.push({ key, input, session, openId, id });
        return { value: partial, target: null };
      }),
  } as unknown as RevitBridge["Service"];
  const makeWeb = () =>
    HttpRouter.toWebHandler(
      Layer.mergeAll(
        makeCallRoute(owner, undefined, { sdk: sdkSessions }),
        opsCatalogRoute(() => Effect.die("not navigation"), sdkSessions),
      ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true },
    );
  let web = makeWeb();
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const url = `http://127.0.0.1${req.url}`;
      paths.push(new URL(url).pathname);
      // The identity middleware's caller step: the CLI's `x-pe-context` names the terminal human.
      const minted = callerOf({ kind: "local" }, req.headers as Record<string, string>);
      if ("refusal" in minted) throw Error(minted.refusal.code);
      const response = await withInvocationContext({ caller: minted.caller }, () =>
        web.handler(
          new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          }),
          Context.empty() as never,
        ),
      );
      if (lose && req.method === "POST" && req.url === "/actions") {
        lose = false;
        res.destroy();
        return;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fakeRuntimeHost(base);
  // The host writes the owner's terminal token at start; the CLI adopts it (BUILD-RULES ruling 1).
  const terminal = writeTerminalContext(resolveLaneAndRoot().serviceName);
  const printed: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args) => {
    printed.push(args.join(" "));
  });
  const source = 'WriteLine("a quoted source");\n// exact file bytes';
  const file = join(dir, "source with spaces.cs");
  await writeFile(file, source);
  const flags = (id: string, session: string) => [
    "--host",
    base,
    "--action-id",
    id,
    "--bridge-session-id",
    session,
    "--open-document-id",
    `open-${session}`,
  ];
  const stdinOriginal = Object.getOwnPropertyDescriptor(process, "stdin")!;
  try {
    const discovery = await (await fetch(`${base}/ops?session=A`)).json();
    expect(discovery).toEqual({
      operations: [...operations, ...tsOnlyOperationCatalog],
      bridgeSessionId: "A",
    });
    expect(
      discovery.operations.some(
        (op: { key: string }) => op.key === "revit.catalog.loaded-families",
      ),
    ).toBe(false);
    await runPeaMain(["script", "execute", "--file", file, ...flags("cli-file-A", "A")]);
    const stream = new PassThrough();
    Object.defineProperty(process, "stdin", { configurable: true, value: stream });
    const stdinRun = runPeaMain(["script", "execute", "--stdin", ...flags("cli-stdin-B", "B")]);
    setTimeout(() => stream.end(source), 20);
    await stdinRun;
    Object.defineProperty(process, "stdin", stdinOriginal);
    const request = join(dir, "request.json");
    await writeFile(request, JSON.stringify({ scriptContent: source, workspaceKey: "default" }));
    await runPeaMain([
      "host",
      "call",
      "--key",
      "scripting.execute",
      "--request-file",
      request,
      ...flags("cli-raw-A", "A"),
    ]);
    expect(effects.map((row) => [row.session, row.openId])).toEqual([
      ["A", "open-A"],
      ["B", "open-B"],
      ["A", "open-A"],
    ]);
    expect(
      effects.every(
        (row) => (row.input as { scriptContent: string }).scriptContent === source && row.id,
      ),
    ).toBe(true);
    const original = (await owner.list(undefined, "cli-raw-A"))[0];
    expect(original).toMatchObject({
      caller: { kind: "human", via: "cli" },
      basis: { kind: "human" },
      kind: "operation",
      result: partial,
    });
    expect(printed.join("\n")).toContain('"failed"');
    await web.dispose();
    owner = new ActionJournal(journal);
    web = makeWeb();
    gone = true;
    // No target selectors and no catalogue/session: this is receipt replay by the original ID.
    await runPeaMain([
      "host",
      "call",
      "--key",
      "scripting.execute",
      "--request-file",
      request,
      "--host",
      base,
      "--action-id",
      "cli-raw-A",
    ]);
    expect((await owner.list(undefined, "cli-raw-A"))[0]).toEqual(original);
    expect(effects).toHaveLength(3);
    expect(paths.every((path) => path === "/ops" || path === "/actions")).toBe(true);
  } finally {
    terminal.retire();
    delete process.env.PE_CONTEXT;
    Object.defineProperty(process, "stdin", stdinOriginal);
    log.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
