import type { IncomingMessage } from "node:http";
import type { Plugin, ProxyOptions } from "vite-plus";
import {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
  hostProcessIdentity,
  sourceHostServiceName,
} from "@pe/host-contracts/service-identity";
import { checkoutRoot } from "./checkout-paths.ts";

export function checkoutServiceName(): string {
  const base = sourceHostServiceName(checkoutRoot);
  const serviceName = process.env[hostProcessIdentity.serviceNameVariable]?.trim() || base;
  if (serviceName !== base && serviceName !== `${base}-no-revit`)
    throw new Error("Dev frontend and host must belong to the same checkout.");
  return serviceName;
}

export function isCheckoutRequest(
  req: Pick<IncomingMessage, "headers" | "url"> & {
    socket: Pick<IncomingMessage["socket"], "localPort">;
  },
): boolean {
  const authority = `127.0.0.1:${req.socket.localPort}`;
  const serviceName = checkoutServiceName();
  const header = req.headers[HOST_RUNTIME_SERVICE_HEADER];
  const query = new URL(req.url ?? "/", `http://${authority}`).searchParams.getAll(
    HOST_RUNTIME_SERVICE_QUERY,
  );
  return (
    (header === undefined || header === serviceName) &&
    query.every((value) => value === serviceName) &&
    req.headers.host === authority &&
    (req.headers.origin === undefined || req.headers.origin === `http://${authority}`)
  );
}

/** Vite is a local checkout frontend, never a second tailnet ingress. */
export function checkoutIngress(): Plugin {
  return {
    name: "pe:checkout-ingress",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!isCheckoutRequest(req)) {
          res.statusCode = 403;
          res.end("Use the exact checkout frontend origin, or the installed Share switch.");
          return;
        }
        const target = process.env[hostProcessIdentity.hostBaseUrlVariable];
        const navigation =
          req.method === "GET" &&
          req.headers["sec-fetch-mode"] === "navigate" &&
          req.headers["sec-fetch-dest"] === "document" &&
          req.headers.accept?.includes("text/html") &&
          !/^\/pages(?:\/|\?|$)/.test(req.url ?? "");
        if (target && navigation) {
          // Vite serves the SPA document. Its navigation must visit the host's existing human mint.
          const headers = new Headers({ [HOST_RUNTIME_SERVICE_HEADER]: checkoutServiceName() });
          for (const key of [
            "accept",
            "origin",
            "referer",
            "cookie",
            "sec-fetch-mode",
            "sec-fetch-dest",
            "sec-fetch-site",
          ]) {
            const value = req.headers[key];
            if (typeof value === "string") headers.set(key, value);
          }
          try {
            const minted = await fetch(new URL("/", target), {
              headers,
              redirect: "manual",
              signal: AbortSignal.timeout(5000),
            });
            const cookie = minted.headers.get("set-cookie");
            await minted.body?.cancel();
            if (!cookie) throw Error("The host did not mint this browser session.");
            res.setHeader("set-cookie", cookie);
          } catch (error) {
            res.statusCode = 503;
            res.end(
              error instanceof Error
                ? error.message
                : "The host could not mint this browser session.",
            );
            return;
          }
        }
        next();
      });
    },
  };
}

/** Product APIs only. TanStack owns documents and server-function routes. */
export function devHostProxy(target: string): Record<string, ProxyOptions> {
  const serviceName = checkoutServiceName();
  return {
    "^/(?:call|events|ops|schemas|host|pe|mcp|demo|captures|pages)(?:/|\\?|$)|^/api/bridge(?:/|\\?|$)|^/actions(?:/(?:recover|resume|cancel))?(?:\\?|$)|^/(?:family/readings|families/readings|schedules/readings)(?:\\?|$)":
      {
        target,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          // Bind each request, not a prior health probe: the port can change owners between them.
          proxy.on("proxyReq", (outgoing) => {
            outgoing.setHeader(HOST_RUNTIME_SERVICE_HEADER, serviceName);
          });
          proxy.on("proxyReqWs", (outgoing, req, socket) => {
            if (isCheckoutRequest(req)) {
              outgoing.setHeader(HOST_RUNTIME_SERVICE_HEADER, serviceName);
              return;
            }
            outgoing.destroy();
            socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          });
        },
        // /ops and /captures are both a document and a JSON API. Sending document navigation
        // to the backend would redirect back here forever.
        bypass(req, res) {
          if (
            req.method === "GET" &&
            /^\/(?:ops|captures)(?:\?|$)/.test(req.url ?? "") &&
            req.headers["sec-fetch-mode"] === "navigate" &&
            req.headers.accept?.includes("text/html")
          )
            return req.url;
          // A Page navigation and its <script>/<link>/<img> loads cannot carry a header. The host
          // writes its own marker into the pe.js it serves, so every door a Page calls is marked.
          if (
            (req.method === "GET" || req.method === "HEAD") &&
            /^\/pages(?:\/|\?|$)/.test(req.url ?? "") &&
            ["document", "iframe", "script", "style", "image", "font"].includes(
              String(req.headers["sec-fetch-dest"]),
            )
          )
            return;
          if (
            (req.headers.origin || req.headers["sec-fetch-site"]) &&
            !req.headers[HOST_RUNTIME_SERVICE_HEADER] &&
            !new URL(req.url ?? "/", target).searchParams.has(HOST_RUNTIME_SERVICE_QUERY)
          ) {
            if (res) {
              res.statusCode = 403;
              res.end(
                "This browser page has no checkout runtime owner. Reload from the checkout frontend.",
              );
            } else req.socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            return false;
          }
        },
      },
  };
}
