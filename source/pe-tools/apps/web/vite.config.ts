import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

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
    devtools() as never,
  ],
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
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
