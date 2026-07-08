import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import type { Plugin } from "vite-plus";
import { defineConfig, loadEnv } from "vite-plus";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const config = defineConfig(({ mode }) => {
  // Server-only secrets (LLAMA_CLOUD_API_KEY, ANTHROPIC_API_KEY) live in the
  // workspace-root .env, one level above apps/web. Vite only surfaces
  // VITE_-prefixed vars to import.meta.env, so lift the ones our API route
  // handlers read into process.env for the dev/SSR server process.
  const rootEnv = loadEnv(mode, `${import.meta.dirname}/../..`, "");
  const serverKeys = [
    "LLAMA_CLOUD_API_KEY",
    "ANTHROPIC_API_KEY",
    "PE_PDF_AUDIT_MODEL",
    "PE_PDF_AUDIT_TIER",
  ];
  for (const key of serverKeys) {
    if (rootEnv[key] && !process.env[key]) process.env[key] = rootEnv[key];
  }

  return {
    plugins: [
      tanstackStart({
        router: {
          quoteStyle: "double",
          semicolons: true,
        },
        // Installed lane serves dist/client statically from the host (no node SSR
        // process), so the build must emit an index.html shell. Server-function
        // routes (pdf-audit labs) are dev-lane only by consequence.
        spa: {
          enabled: true,
          prerender: {
            outputPath: "/index.html",
            crawlLinks: false,
          },
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
    // Dev proxy to the squashed Effect host (port 5180), which serves the SPA and
    // absorbs the former Mastra agent server. Single same-origin target, no rewrites,
    // no token injection. Installed builds have the host serve the SPA directly, so this
    // proxy is dev-only. ponytail: one target for every host-backed path the app uses.
    server: {
      proxy: (() => {
        const target = process.env.PE_TOOLS_HOST_BASE_URL ?? "http://127.0.0.1:5180";
        const options = { target, changeOrigin: true } as const;
        return {
          "/call": options,
          "/events": options,
          "/ops": options,
          "/schemas": options,
          "/host": options,
          "/pe": options,
          "/api/agent-controller": options,
        };
      })(),
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
  };
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
