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
import { sdkSessions } from "./native-receipt-fixture.ts";

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
    status: "partial",
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
            processId: 42,
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
        opsCatalogRoute(() => Effect.die("not navigation")),
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
      const response = await web.handler(
        new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
        Context.empty() as never,
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
    "--actor",
    "human",
    "--action-id",
    id,
    "--bridge-session-id",
    session,
    "--open-document-id",
    `open-${session}`,
  ];
  const stdinOriginal = Object.getOwnPropertyDescriptor(process, "stdin")!;
  try {
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
      "operations",
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
    expect(original).toMatchObject({ actor: "human", kind: "operation", result: partial });
    expect(printed.join("\n")).toContain('"failed"');
    await web.dispose();
    owner = new ActionJournal(journal);
    web = makeWeb();
    gone = true;
    // No target selectors and no catalogue/session: this is receipt replay by the original ID.
    await runPeaMain([
      "host",
      "operations",
      "call",
      "--key",
      "scripting.execute",
      "--request-file",
      request,
      "--host",
      base,
      "--actor",
      "human",
      "--action-id",
      "cli-raw-A",
    ]);
    expect((await owner.list(undefined, "cli-raw-A"))[0]).toEqual(original);
    expect(effects).toHaveLength(3);
    expect(paths.every((path) => path === "/ops" || path === "/actions")).toBe(true);
  } finally {
    Object.defineProperty(process, "stdin", stdinOriginal);
    log.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
