import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createServer, type PluginOption, type ViteDevServer } from "vite-plus";
import type { Socket } from "node:net";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { withInvocationContext } from "@pe/runtime/context";
import { matchPeRoute, peRoutes, peRouteUrl } from "@pe/agent-contracts/pe-api";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { Caller } from "@pe/agent-contracts";
import { nativeFixture } from "../../host/tests/fans-native.fixture.ts";
import { receiptBuildDefines } from "../../host/src/build-stamp.ts";

/** An owned fixture-native server. No SDK execution, Revit connection or installed product. */
export async function startFansFixtureHost() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const fixture = async (name: string) =>
    nativeResponseSchema("ducts.snapshot.walk").parse(
      JSON.parse(
        await readFile(
          new URL(`../../../packages/host-contracts/src/fixtures/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    );
  const [roster, fan, system] = await Promise.all([
    fixture("k2-roster"),
    fixture("k2-four-fan-walk"),
    fixture("k2-system-walk"),
  ]);
  const native = await nativeFixture("real", (key, input) => {
    if (key === "ducts.snapshot.roster" || input.selector?.kind === "roster") return roster;
    if (input.selector?.kind === "from" || input.selector?.kind === "ids") return fan;
    if (
      input.selector?.kind === "systems" &&
      !system.systems.some((row) => input.selector.systemIds.includes(row.id))
    )
      return { ...system, systems: [], groups: [], nodes: [], segments: [], flows: [], issues: [] };
    return system;
  });
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  const sockets = new Set<Socket>();
  try {
    const human: Caller = { kind: "human", via: "local" };
    const api = native.api;
    server = await createServer({
      configFile: false,
      root,
      resolve: { alias: { "#": `${root}/src` } },
      define: {
        "import.meta.env.PE_RUNTIME_SERVICE": JSON.stringify("fans-fixture"),
        __PE_WEB_RECEIPT_BUILD__: receiptBuildDefines("dev").__PE_WEB_RECEIPT_BUILD__,
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        fs: { allow: [fileURLToPath(new URL("../../../../", import.meta.url))] },
      },
      plugins: [
        react(),
        tailwind(),
        {
          name: "fans-native-fixture",
          configureServer(vite: ViteDevServer) {
            vite.middlewares.use(async (req, res, next) => {
              const url = new URL(req.url ?? "/", "http://fixture");
              if ((url.pathname === "/fans" || url.pathname === "/ducts") && req.method === "GET") {
                res.setHeader("content-type", "text/html");
                res.end(
                  await vite.transformIndexHtml(
                    url.pathname,
                    '<!doctype html><html class="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/scripts/fans-browser.fixture.tsx"></script></body></html>',
                  ),
                );
                return;
              }
              if (!/^\/(fixture|pe|actions|call|readings|ducts)(\/|$)/.test(url.pathname)) {
                next();
                return;
              }
              try {
                let body = "";
                for await (const bytes of req) body += bytes.toString();
                const request = new Request(url, {
                  method: req.method,
                  headers: req.headers as Record<string, string>,
                  ...(body && { body }),
                });
                let response: Response;
                const declared = matchPeRoute(req.method ?? "GET", url.pathname);
                if (declared?.id === "ducts.catalogs")
                  response = Response.json({ tables: {}, findings: [] });
                else if (declared?.id === "thread.permission") {
                  const input = peRoutes["thread.permission"].body.parse(JSON.parse(body));
                  const accepted = native.runs.decide(
                    declared.params.id!,
                    input.requestId,
                    input.optionId,
                  );
                  response = Response.json({ ok: accepted }, { status: accepted ? 200 : 409 });
                } else if (url.pathname === "/fixture/config")
                  response = Response.json({
                    target: native.target,
                    system: system.systems[0]?.name,
                    join: ["14577391:2", "14605353:1"],
                  });
                else if (url.pathname === "/fixture/evidence")
                  response = Response.json({
                    native: [...native.native],
                    work: await native.saved.view(native.key, "ducts"),
                    receipts: await native.journal.list(),
                    events: native.events,
                    dispatched: native.dispatched,
                  });
                else if (url.pathname === "/fixture/pea-work") {
                  const input = JSON.parse(body);
                  const view = await native.saved.view(native.key, "ducts");
                  response = await withInvocationContext(
                    { caller: { kind: "pea", context: "fixture-minted", thread: "fans-browser" } },
                    () =>
                      api.fetch(
                        new Request(
                          peRouteUrl(
                            "work.apply",
                            {
                              params: { route: "ducts" },
                              query: {
                                open: `${native.target.ref.session}/${native.target.ref.openId}`,
                              },
                            },
                            "http://fixture",
                          ),
                          {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              kind: "apply",
                              press: crypto.randomUUID(),
                              expectedRevision: view!.revision,
                              label: input.label,
                              patches: input.patches,
                            }),
                          },
                        ),
                      ),
                  );
                } else if (url.pathname === "/fixture/pea") {
                  const run = {
                    thread: `fans-browser-${crypto.randomUUID()}`,
                    turn: crypto.randomUUID(),
                  };
                  native.runs.open(run);
                  const caller: Caller = {
                    kind: "pea",
                    context: "fixture-minted",
                    thread: run.thread,
                    run,
                    root: run,
                  };
                  const view = await native.saved.view(native.key, "ducts");
                  const work = { key: native.key, revision: view!.revision };
                  const previewId = crypto.randomUUID();
                  await native.post(
                    "/actions",
                    {
                      id: previewId,
                      key: "ducts.preview-losses",
                      target: native.target,
                      input: { work },
                    },
                    human,
                  );
                  const preview = await native.journal.wait(previewId);
                  if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
                  response = await native.post(
                    "/actions",
                    {
                      id: crypto.randomUUID(),
                      key: "ducts.apply-losses",
                      target: native.target,
                      input: { work },
                    },
                    caller,
                  );
                } else
                  response = await withInvocationContext({ caller: human }, () =>
                    url.pathname.startsWith("/pe/") ? api.fetch(request) : native.request(request),
                  );
                res.writeHead(response.status, Object.fromEntries(response.headers));
                if (response.body) {
                  const stream = Readable.fromWeb(
                    response.body as import("node:stream/web").ReadableStream,
                  );
                  res.on("close", () => stream.destroy());
                  stream.pipe(res);
                } else res.end();
              } catch (error) {
                res.statusCode = 500;
                res.end(String(error));
              }
            });
          },
        },
      ] as unknown as PluginOption[],
    });
    server.httpServer?.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw Error("No fixture port");
    const owned = server;
    return {
      url: `http://127.0.0.1:${address.port}`,
      native,
      async close() {
        for (const socket of sockets) socket.destroy();
        await owned.close();
        await native.close();
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await server?.close();
    await native.close();
    throw error;
  }
}
