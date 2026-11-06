import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerRespondable, HttpServerResponse, HttpStaticServer } from "effect/http";
import { appRouteByPath } from "@pe/agent-contracts";
import { InvalidRead } from "./native-reads.ts";
import { hostOwnership } from "./host-ownership.ts";

/**
 * Where the built SPA lives (Pillar 5):
 * - installed lane: `<exeDir>/web/client` (the contract with the C# packaging side).
 * - dev: `PE_TOOLS_WEB_DIST` if set (dev usually runs vite with HMR instead, so this is normally
 *   unset and static serving is skipped).
 */
export function resolveWebRoot(): string | null {
  const bundled = join(dirname(process.execPath), "web", "client");
  if (hostOwnership.lane === "installed" || existsSync(bundled)) return bundled;
  return process.env.PE_TOOLS_WEB_DIST?.trim() || null;
}

/**
 * SPA static layer, mounted at `GET /*` and merged LAST so API routes win. Its deps
 * (FileSystem/Path/HttpPlatform/Etag) are already bundled by `NodeHttpServer.layer`. When the root
 * is absent, live serving is a no-op; the historical refusal boundary reports missing web assets.
 */
export function staticSpaLayer(root: string | null, refused?: Effect.Effect<HttpServerResponse.HttpServerResponse, InvalidRead>) {
  if (!refused) {
    if (!root || !existsSync(root)) return Layer.empty;
    return HttpStaticServer.layer({ root, spa: true, index: "index.html" });
  }
  // One fallback dispatcher: API/control requests never compete with the SPA wildcard.
  return Layer.unwrap(Effect.gen(function* () {
    const serve = root && existsSync(root)
      ? (yield* HttpStaticServer.make({ root, spa: true, index: "index.html" })).pipe(Effect.catch(HttpServerRespondable.toResponse))
      : Effect.fail(new InvalidRead({ message: "Recording web assets are unavailable", status: 503, problem: "recording.coverage" }));
    return HttpRouter.add("*", "/*", (request) => webRequest(request) ? serve : refused);
  }));
}

// TODO: reconcile admitted trailing-slash navigation aliases without broadening API or recorded-Page fallback.
const webRequest = (request: HttpServerRequest.HttpServerRequest) => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = new URL(decodeURIComponent(new URL(request.url, "http://host").pathname).replaceAll("\\", "/").replace(/\/{2,}/g, "/"), "http://host").pathname;
  return ((request.headers.accept ?? "").includes("text/html") && (pathname === "/" || !!appRouteByPath(pathname))) ||
    pathname.startsWith("/assets/") || /^\/[^/]+\.(?:ico|svg|png|webmanifest|txt)$/.test(pathname) || pathname === "/manifest.json";
};
