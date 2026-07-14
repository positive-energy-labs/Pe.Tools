import "./ensure-source-lane.ts"; // MUST be first: sets PE_LANE=dev for source runs before load
import path from "node:path";
import { Effect } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { createServer } from "vite-plus";
import { hostProgram } from "./host-program.ts";

const webRoot = path.resolve(import.meta.dirname, "..", "..", "web");

const vite = Effect.acquireRelease(
  Effect.tryPromise({
    try: async () => {
      const server = await createServer({
        root: webRoot,
        configFile: path.join(webRoot, "vite.config.ts"),
        server: { host: "127.0.0.1", port: 5173, strictPort: true },
      });
      await server.listen();
      server.printUrls();
      return server;
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }),
  (server) => Effect.promise(() => server.close()),
);

// One process owns both listeners: Vite/HMR on 5173 and the Effect host on 5180.
NodeRuntime.runMain(hostProgram(vite));
