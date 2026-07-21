import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev before host ownership loads
import { createServer as createNodeServer } from "node:http";
import path from "node:path";
import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { createServer as createViteServer } from "vite-plus";
import { hostProgram } from "./host-program.ts";
import { VITE_HMR_PATH } from "./vite-web.ts";

const webRoot = path.resolve(import.meta.dirname, "..", "..", "web");

NodeRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      const nodeServer = createNodeServer();
      const vite = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            createViteServer({
              root: webRoot,
              configFile: path.join(webRoot, "vite.config.ts"),
              server: {
                middlewareMode: true,
                // ponytail: PE_DEV_NO_HMR for WS-less clients (agent browser proxies) — the
                // vite client otherwise reload-loops when the HMR upgrade can't connect.
                hmr: process.env.PE_DEV_NO_HMR
                  ? false
                  : { server: nodeServer, path: VITE_HMR_PATH },
              },
            }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (server) => Effect.promise(() => server.close()),
      );

      yield* hostProgram({
        beforeHost: Effect.void,
        nodeServer,
        viteServer: vite,
      });
    }),
  ),
);
