import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import type { Plugin } from "vite-plus";
import { defineConfig } from "vite-plus";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const config = defineConfig({
  plugins: [
    tanstackStart({
      router: {
        quoteStyle: "double",
        semicolons: true,
      },
    }) as never,
    tanstackStartVite8DevMiddleware() as never,
    react() as never,
    tailwindcss() as never,
    devtools({
      injectSource: { enabled: false },
      consolePiping: { enabled: false },
    }) as never,
  ],
  // Dev proxy to the workbench agent server (apps/pea/pe-code). `pe-dev web` also
  // passes ?w=<port>, but these keep plain `vp dev` usable against the default backend.
  server: {
    proxy: {
      "/pe": {
        target: process.env.PE_WORKBENCH_AGENT_URL ?? "http://127.0.0.1:43112",
        changeOrigin: true,
        headers: {
          "x-runtime-workbench-token": process.env.PE_WORKBENCH_DEV_TOKEN ?? "dev-loopback",
        },
      },
      "/api/agent-controller": {
        target: process.env.PE_WORKBENCH_AGENT_URL ?? "http://127.0.0.1:43112",
        changeOrigin: true,
      },
      // ponytail: dev-only passthrough so browser RPC calls to /pe-host/rpc reach the TS host.
      "/pe-host": {
        target: process.env.PE_TOOLS_HOST_BASE_URL ?? "http://localhost:5180",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pe-host/, ""),
      },
    },
  },
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  // assistant-ui ships React-Compiler output (`useMemoCache`); under TanStack Start's
  // multi-environment optimizer it can bind to a different React prebundle than react-dom's
  // active dispatcher → "Cannot read properties of null (reading 'useMemoCache')". Forcing these
  // into one optimize pass keeps a single React instance. ponytail: drop if the optimizer stops splitting.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@assistant-ui/react",
      "@assistant-ui/react-markdown",
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});

export default config;

// ponytail: remove once TanStack Start registers its dev SSR middleware for Vite+.
function tanstackStartVite8DevMiddleware(): Plugin {
  return {
    name: "pe:tanstack-start-vite8-dev-middleware",
    apply: "serve",
    configureServer(server) {
      return () => {
        const ssr = server.environments?.ssr as
          | { runner?: { import?: (id: string) => Promise<unknown> } }
          | undefined;
        const runner = ssr?.runner;

        if (typeof runner?.import !== "function") {
          return;
        }

        const importServerEntry = runner.import.bind(runner);

        server.middlewares.use(async (req, res, next) => {
          try {
            const mod = (await importServerEntry("virtual:tanstack-start-server-entry")) as {
              default?: { fetch?: (request: Request) => Promise<Response> };
            };
            const response = await mod.default?.fetch?.(toRequest(req));

            if (!response) {
              next();
              return;
            }

            await sendResponse(res, response);
          } catch (error) {
            next(error);
          }
        });
      };
    },
  };
}

function toRequest(req: {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const url = new URL(req.url ?? "/", `http://${headers.get("host") ?? "localhost"}`);
  const method = req.method ?? "GET";
  const init = {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : req,
    duplex: "half",
  } as RequestInit & { duplex?: "half" };

  return new Request(url, init);
}

async function sendResponse(
  res: {
    statusCode: number;
    statusMessage: string;
    setHeader(name: string, value: string): void;
    end(data?: Buffer): void;
  },
  response: Response,
) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
