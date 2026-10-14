import { Deferred, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  BRIDGE_PATH,
  HOST_RUNTIME_SERVICE_HEADER,
  HOST_RUNTIME_SERVICE_QUERY,
} from "@pe/host-contracts/contracts";
import { hostOwnership } from "./host-ownership.ts";
import { withInvocationContext, type RequestPrincipal } from "@pe/runtime/context";
import type { Caller, MachineShare } from "@pe/agent-contracts";
import { matchPeRoute } from "@pe/agent-contracts/pe-api";
import {
  admitRequest,
  callerOf,
  mintBrowserContext,
  Refused,
  type RoutePermission,
} from "./control.ts";
import { HostLifecycle } from "./host-lifecycle.ts";
import { authorizeShutdownFor } from "@pe/host-contracts/pe-service-host";

export type IdentityResult =
  | {
      readonly principal: RequestPrincipal;
      readonly headers: Readonly<Record<string, string>>;
      /** Minted from the transport and `x-pe-context`; never from a body or page header. */
      readonly caller: Caller;
      readonly setCookie?: string;
    }
  | { readonly refusal: { readonly code: string; readonly detail: string } };

export interface IdentityOptions {
  readonly port: () => number;
  readonly frontendOrigin: () => string | undefined;
  readonly share: {
    read(): Promise<MachineShare>;
    observe(result: IdentityResult, path: string, from: string): void;
  };
}

/** Only URL authority normalization is allowed; no credentials, path, or forwarded-host fallback. */
function authority(value: string): string | undefined {
  if (!/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(value)) return undefined;
  try {
    return new URL(`https://${value}`).host;
  } catch {
    return undefined;
  }
}

export async function readRequestIdentity(
  headers: Readonly<Record<string, string | undefined>>,
  path: string,
  options: IdentityOptions,
  method = "GET",
  serviceAuthorized = false,
): Promise<IdentityResult> {
  const expectedService = headers[HOST_RUNTIME_SERVICE_HEADER];
  let queryServices: string[];
  try {
    queryServices = new URL(path, "http://127.0.0.1").searchParams.getAll(
      HOST_RUNTIME_SERVICE_QUERY,
    );
  } catch {
    return { refusal: { code: "identity.path", detail: "Request path cannot be normalized." } };
  }
  if (
    (expectedService !== undefined && expectedService !== hostOwnership.serviceName) ||
    queryServices.some((value) => value !== hostOwnership.serviceName)
  )
    return {
      refusal: {
        code: "runtime.owner-mismatch",
        detail: `Caller requires '${expectedService ?? queryServices.join(",")}', but this host is '${hostOwnership.serviceName}'.`,
      },
    };
  let pathname: string;
  try {
    pathname =
      new URL(
        decodeURIComponent(new URL(path, "http://127.0.0.1").pathname)
          .replaceAll("\\", "/")
          .replace(/\/{2,}/g, "/"),
        "http://127.0.0.1",
      ).pathname.replace(/\/$/, "") || "/";
  } catch {
    return { refusal: { code: "identity.path", detail: "Request path cannot be normalized." } };
  }
  const host = headers.host ?? "";
  const permission = requestPermission(pathname, method);
  const origin = headers.origin;
  const refuse = (code: string, detail: string): IdentityResult => ({ refusal: { code, detail } });
  const browser = origin !== undefined || headers["sec-fetch-site"] !== undefined;
  const navigation =
    (method === "GET" || method === "HEAD") &&
    (headers.accept ?? "").includes("text/html") &&
    (headers["sec-fetch-mode"] === "navigate" ||
      ["document", "iframe"].includes(headers["sec-fetch-dest"] ?? ""));
  const staticResource =
    (method === "GET" || method === "HEAD") &&
    ["script", "style", "image", "font", "manifest"].includes(headers["sec-fetch-dest"] ?? "") &&
    /\.(?:m?js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|webmanifest|map)$/i.test(pathname);
  if (
    browser &&
    !navigation &&
    !staticResource &&
    expectedService === undefined &&
    queryServices.length === 0
  )
    return refuse(
      "runtime.owner-missing",
      "Browser API requests require their original runtime service identity.",
    );
  const anonymous: Caller = { kind: "anonymous" };
  let result: IdentityResult;
  if (host === `127.0.0.1:${options.port()}`) {
    const proxyIdentity = Object.keys(headers).some((key) => key.startsWith("tailscale-"));
    result = proxyIdentity
      ? refuse("identity.forged-proxy", "Proxy identity is not accepted on the local authority.")
      : origin !== undefined &&
          origin !== `http://127.0.0.1:${options.port()}` &&
          origin !== options.frontendOrigin()
        ? refuse("identity.origin", "Origin is not this host or its recorded checkout frontend.")
        : { principal: { kind: "local" }, headers: origin ? { origin } : {}, caller: anonymous };
  } else {
    const share = await options.share.read();
    const shared =
      share.state === "on" && share.desired === "on" && share.url ? new URL(share.url) : undefined;
    const login = headers["tailscale-user-login"]?.trim();
    result =
      !shared || authority(host) !== shared.host
        ? refuse(
            "identity.host",
            "Host is neither canonical loopback nor the verified sharing authority.",
          )
        : origin !== undefined && origin !== shared.origin
          ? refuse("identity.origin", "Origin is not the verified sharing origin.")
          : !login
            ? refuse(
                "identity.missing-user",
                "Serve user identity is required; tagged devices and Funnel are not admitted.",
              )
            : {
                principal: { kind: "tailnet", login, authority: shared.host },
                caller: anonymous,
                headers: {
                  host: shared.host,
                  "tailscale-user-login": login,
                  ...(headers["tailscale-user-name"]
                    ? { "tailscale-user-name": headers["tailscale-user-name"] }
                    : {}),
                  ...(headers["tailscale-user-profile-pic"]
                    ? { "tailscale-user-profile-pic": headers["tailscale-user-profile-pic"] }
                    : {}),
                  ...(origin !== undefined ? { origin } : {}),
                },
              };
    if (
      "principal" in result &&
      share.allowRemoteAdministration === false &&
      (permission === "admin" || permission === "grant")
    )
      result = refuse(
        "identity.remote-administration",
        "Remote machine administration is disabled on this host. Product operations remain available.",
      );
  }
  if (
    "principal" in result &&
    result.principal.kind !== "local" &&
    (pathname === BRIDGE_PATH ||
      pathname === "/admin/shutdown" ||
      pathname === "/admin/window" ||
      pathname === "/pe/share" ||
      pathname.startsWith("/pe/share/"))
  )
    result = refuse(
      "identity.local-only",
      "The bridge, SDK shutdown, window and share switch are local-only.",
    );
  if ("principal" in result) {
    const minted =
      serviceAuthorized && result.principal.kind === "local"
        ? { caller: { kind: "service", service: hostOwnership.serviceName } as Caller }
        : callerOf(result.principal, headers);
    result =
      "refusal" in minted
        ? refuse(minted.refusal.code, minted.refusal.detail)
        : { ...result, caller: minted.caller };
    if ("principal" in result) {
      try {
        admitRequest(result.caller, permission, `${method} ${pathname}`);
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        result = refuse(error.refusal.code, error.refusal.reason);
      }
    }
    if ("principal" in result && navigation && !pathname.startsWith("/pages"))
      result = { ...result, setCookie: mintBrowserContext(result.principal) };
  }
  options.share.observe(result, pathname, host);
  return result;
}

/** The declared API owns product permissions; protocol and machine lifecycle are separate transports. */
function requestPermission(path: string, method: string): RoutePermission {
  const declared = matchPeRoute(method === "HEAD" ? "GET" : method, path);
  if (declared) return declared.route.permission;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "read";
  if (path === "/mcp") return "mcp";
  if (path === "/admin/shutdown" || path === "/admin/window") return "service";
  if (method === "POST" && (path === "/host/update" || path === "/host/update/automatic"))
    return "admin";
  return "caller";
}

/** A global router middleware also covers unmatched/static requests and WebSocket upgrades. */
export const requestIdentityLayer = (options: IdentityOptions) =>
  HttpRouter.middleware(
    (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        let serviceAuthorized = false;
        if (
          request.method === "POST" &&
          ["/admin/shutdown", "/admin/window"].includes(request.url.split("?")[0]!)
        ) {
          const lifecycle = yield* Effect.serviceOption(HostLifecycle);
          if (lifecycle._tag === "Some") {
            const ready = yield* Deferred.poll(lifecycle.value.handle);
            if (ready._tag === "Some") {
              const handle = yield* ready.value;
              const body = yield* Effect.orElseSucceed(request.json, () => null);
              serviceAuthorized = authorizeShutdownFor(handle)(request.headers, body);
            }
          }
        }
        const identity = yield* Effect.promise(() =>
          readRequestIdentity(
            request.headers,
            request.originalUrl,
            options,
            request.method,
            serviceAuthorized,
          ),
        );
        if ("refusal" in identity) return HttpServerResponse.jsonUnsafe(identity, { status: 403 });
        const services = yield* Effect.context<never>();
        const exit = yield* Effect.promise((signal) =>
          withInvocationContext(
            {
              hostBaseUrl: `http://127.0.0.1:${options.port()}`,
              principal: identity.principal,
              caller: identity.caller,
              headers: identity.headers,
            },
            () => Effect.runPromiseExitWith(services)(handler, { signal }),
          ),
        );
        const response = yield* exit;
        return identity.setCookie
          ? HttpServerResponse.setHeader(response, "set-cookie", identity.setCookie)
          : response;
      }),
    { global: true },
  );
