import type { IncomingMessage } from "node:http";
import type { Plugin, ProxyOptions } from "vite-plus";

export function isCheckoutRequest(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const authority = `127.0.0.1:${req.socket.localPort}`;
  return (
    req.headers.host === authority &&
    (req.headers.origin === undefined || req.headers.origin === `http://${authority}`)
  );
}

/** Vite is a local checkout frontend, never a second tailnet ingress. */
export function checkoutIngress(): Plugin {
  return {
    name: "pe:checkout-ingress",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (isCheckoutRequest(req)) return next();
        res.statusCode = 403;
        res.end("Use the exact checkout frontend origin, or the installed Share switch.");
      });
    },
  };
}

/** Product APIs only. TanStack owns documents and server-function routes. */
export function devHostProxy(target: string): Record<string, ProxyOptions> {
  return {
    "^/(?:call|events|ops|schemas|host|pe|mcp|demo|captures|pages)(?:/|\\?|$)|^/api/bridge(?:/|\\?|$)|^/actions(?:/(?:recover|resume|cancel))?(?:\\?|$)|^/(?:family/readings|families/readings|schedules/readings)(?:\\?|$)":
      {
        target,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          // Origin and identity headers pass unchanged; only the local backend Host changes.
          proxy.on("proxyReqWs", (outgoing, req, socket) => {
            if (isCheckoutRequest(req)) return;
            outgoing.destroy();
            socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          });
        },
        // /ops and /captures are both a document and a JSON API. Sending document navigation
        // to the backend would redirect back here forever.
        bypass(req) {
          if (
            req.method === "GET" &&
            /^\/(?:ops|captures)(?:\?|$)/.test(req.url ?? "") &&
            req.headers.accept?.includes("text/html")
          )
            return req.url;
        },
      },
  };
}
