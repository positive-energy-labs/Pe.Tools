import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import type { Plugin } from "vite-plus";
import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite-plus";

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
    // OPT-IN dev proxy to a host — restored 2026-08-17 after forensics. e88bd26 deleted the
    // always-on proxy for worktree isolation (each lane's host takes over and serves its own
    // web origin); the unintended casualty was the plain vite origin, whose host lane went
    // dead silently (/call 404 → /settings targeting emptied). This version keeps isolation:
    // NO env var → no proxy, exactly the takeover-era behavior. Set PE_TOOLS_HOST_BASE_URL
    // to bind THIS lane's web to THIS lane's host explicitly (e.g. http://127.0.0.1:5180).
    server: {
      fs: {
        allow: [
          searchForWorkspaceRoot(import.meta.dirname),
          fileURLToPath(new URL("../../../Pe.Revit.Tests/Fixtures/FamilyModel", import.meta.url)),
        ],
      },
      ...(process.env.PE_TOOLS_HOST_BASE_URL
        ? {
            proxy: (() => {
              const options = {
                target: process.env.PE_TOOLS_HOST_BASE_URL,
                changeOrigin: true,
              } as const;
              return {
                "/call": options,
                "/events": options,
                "/ops": options,
                "/schemas": options,
                "/host": options,
                "/sessions": options,
                "/pe": options,
              };
            })(),
          }
        : {}),
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
    test: { setupFiles: ["./src/test-setup.ts"] },
  };
});

export default config;

// SHIM: TanStack Start's dev-server plugin silently skips registering its SSR document middleware
// under Vite 8 / Vite+ (its `isRunnableDevEnvironment` guard rejects the Vite+ ssr environment), so
// document routes fall through and `GET /` 404s while `GET /@vite/client` still returns 200.
// Forcing `tanstackStart({ vite: { installDevServerMiddleware: true } })` hits the same guard, so
// instead this dev-only plugin feature-checks `server.environments.ssr.runner.import`, imports
// `virtual:tanstack-start-server-entry`, and forwards document requests to its `fetch` handler.
// `runner.import` must stay bound to `runner` (it needs itself as `this`, else "Cannot read
// properties of undefined (reading 'cachedModule')"). Upstream: TanStack/router#7614.
// Related: do NOT set `ssr.noExternal: true` here — it forces React's CJS entry through the Vite+
// SSR evaluator and SSR dies with "module is not defined" at react/index.js; `resolve.dedupe` above
// is the correct monorepo guard.
// Removal condition: upstream TanStack Start registers its dev SSR middleware under Vite+ (or this
// app stops running Start through Vite+). Then delete this plugin and verify `GET /`, `GET /about`,
// `GET /@vite/client` all return 200 under `vp dev`, plus `vp check` and `vp build`.
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
    headersSent: boolean;
    setHeader(name: string, value: string): void;
    end(data?: Buffer): void;
  },
  response: Response,
) {
  // The SSR fetch can resolve after the response was already answered elsewhere (client abort,
  // another middleware) — writing then throws "Cannot set headers after they are sent".
  if (res.headersSent) return;
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
