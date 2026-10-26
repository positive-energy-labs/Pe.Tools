import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import { hostOpSafety } from "@pe/host-contracts/generated";
import { familyReads, scheduleReads, readingRequestsSchema } from "@pe/agent-contracts";
import type { Plugin, ProxyOptions } from "vite-plus";
import {
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
  hostProcessIdentity,
  sourceHostServiceName,
  checkoutRootFrom,
} from "@pe/host-contracts/service-identity";
import { checkoutRoot } from "./checkout-paths.ts";

/** Web-only exception: borrow another checkout's reads, never its host lifecycle or writes. */
export function readHostCheckout(): string | undefined {
  const configured = process.env.PE_WEB_READ_HOST_CHECKOUT?.trim();
  if (!configured) return;
  const root = resolve(configured);
  if (checkoutRootFrom(root)?.toLowerCase() !== root.toLowerCase())
    throw Error("PE_WEB_READ_HOST_CHECKOUT must name a Pe.Tools checkout root.");
  const target = new URL(process.env.PE_TOOLS_HOST_BASE_URL ?? "");
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/" ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw Error("Read-only host must be an exact http://127.0.0.1:<port> origin.");
  return root;
}

export function readHostRequest(method: string, url: string, body?: unknown): boolean {
  const path = new URL(url, "http://127.0.0.1").pathname;
  if (method === "POST" && path === "/call") {
    const call = body as { key?: unknown } | null;
    if (typeof call?.key !== "string" || !Object.hasOwn(hostOpSafety, call.key)) return false;
    const safety = hostOpSafety[call.key as keyof typeof hostOpSafety];
    return safety.intent === "Read" && safety.usesTransactions === false;
  }
  if (method === "POST" && ["/family/readings", "/schedules/readings"].includes(path)) {
    const read = body as { key?: unknown; input?: { evaluate?: unknown } } | null;
    const key = read?.key;
    return (
      typeof key === "string" &&
      // The optional evaluation adapter calls a native apply preview, which can transact.
      !(path === "/family/readings" && read?.input?.evaluate === true) &&
      Object.hasOwn(path === "/family/readings" ? familyReads : scheduleReads, key)
    );
  }
  if (method !== "GET") return false;
  if (path === "/pe/resources") {
    try {
      const requests = readingRequestsSchema.parse(
        JSON.parse(new URL(url, "http://127.0.0.1").searchParams.get("keys") ?? "null"),
      );
      // This read adapter performs temporary family placement; GET is not a safety signal.
      return requests.every(
        (request) =>
          request.kind !== "families-matrix" ||
          readHostRequest("POST", "/call", { key: "revit.matrix.loaded-families" }),
      );
    } catch {
      return false;
    }
  }
  return (
    matchPeRoute(method, path)?.route.permission === "read" ||
    [
      "/host/status",
      "/ops",
      "/pe/ducts/catalogs",
      "/captures",
      "/captures/",
      "/family/readings",
      "/families/readings",
    ].includes(path) ||
    /^\/captures\/[0-9a-f]{64}\.png$/.test(path)
  );
}

export function checkoutServiceName(): string {
  const base = sourceHostServiceName(readHostCheckout() ?? checkoutRoot);
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
  const install: NonNullable<Plugin["configureServer"]> = (server) => {
    server.middlewares.use(async (req, res, next) => {
      await checkoutMiddleware(req, res, next);
    });
  };
  return {
    name: "pe:checkout-ingress",
    configureServer: install,
    configurePreviewServer: install as Plugin["configurePreviewServer"],
  };
}

/** API and document paths overlap; only real document requests enter the app shell. */
export function isAppNavigation(req: Pick<IncomingMessage, "method" | "headers" | "url">) {
  return (
    req.method === "GET" &&
    (req.headers["sec-fetch-mode"] === "navigate" || req.headers.accept?.includes("text/html")) &&
    !/^\/(?:call|events|schemas|host|pe|mcp|demo|pages|api|admin|actions)(?:\/|\?|$)/.test(
      req.url ?? "",
    )
  );
}

async function checkoutMiddleware(
  req: IncomingMessage,
  res: import("node:http").ServerResponse,
  next: (error?: unknown) => void,
) {
  if (!isCheckoutRequest(req)) {
    res.statusCode = 403;
    res.end("Use the exact checkout frontend origin, or the installed Share switch.");
    return;
  }
  const target = process.env[hostProcessIdentity.hostBaseUrlVariable];
  const readOnly = readHostCheckout() !== undefined;
  const navigation = isAppNavigation(req);
  // This middleware owns every host door in borrowed mode, before Vite's general proxy.
  if (
    readOnly &&
    !navigation &&
    /^\/(?:call|events|ops|schemas|host|pe|mcp|demo|captures|pages|api|admin|actions|family|families|schedules)(?:\/|\?|$)/.test(
      req.url ?? "",
    )
  ) {
    try {
      let body: string | undefined;
      if (
        req.method === "POST" &&
        ["/call", "/family/readings", "/schedules/readings"].includes(
          new URL(req.url!, target).pathname,
        )
      ) {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += Buffer.byteLength(chunk);
          // Whole-building reads enumerate element ids (Chadds exceeds 64 KiB); admission still
          // checks generated read-only operation metadata before anything reaches the host.
          if (bytes > 1_048_576) throw Error("Read request exceeds 1 MiB.");
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks).toString("utf8");
      }
      if (!readHostRequest(req.method ?? "GET", req.url!, body ? JSON.parse(body) : undefined)) {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: {
              code: "read-only-frontend",
              message:
                "This frontend borrows host reads only. Writes and host lifecycle are disabled.",
            },
          }),
        );
        return;
      }
      const headers = new Headers({ [HOST_RUNTIME_SERVICE_HEADER]: checkoutServiceName() });
      for (const [key, value] of Object.entries(req.headers))
        if (
          typeof value === "string" &&
          ![
            "host",
            "origin",
            "referer",
            "connection",
            "content-length",
            "accept-encoding",
          ].includes(key)
        )
          headers.set(key, value);
      headers.set("origin", new URL(target!).origin);
      if (req.headers.referer)
        headers.set("referer", new URL(new URL(req.headers.referer).pathname, target).href);
      const controller = new AbortController();
      res.on("close", () => controller.abort());
      const upstream = await fetch(new URL(req.url!, target), {
        method: req.method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      res.statusCode = upstream.status;
      upstream.headers.forEach((value, key) => {
        if (
          !["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(key)
        )
          res.setHeader(key, value);
      });
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as never), res);
      else res.end();
    } catch (error) {
      if (res.destroyed) return;
      if (!res.headersSent) res.statusCode = 502;
      res.end(error instanceof Error ? error.message : "Borrowed host read failed.");
    }
    return;
  }
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
    if (readOnly) {
      headers.set("origin", new URL(target).origin);
      headers.delete("referer");
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
        error instanceof Error ? error.message : "The host could not mint this browser session.",
      );
      return;
    }
  }
  next();
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
            if (!readHostCheckout() && isCheckoutRequest(req)) {
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
          if (isAppNavigation(req)) return req.url;
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
