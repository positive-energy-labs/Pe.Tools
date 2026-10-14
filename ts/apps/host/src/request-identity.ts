import { Deferred, Effect, Option } from "effect";
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
import { deviceCredential, type Devices } from "./remote-device.ts";
import type { DeviceTransport } from "@pe/host-contracts/pe-api";

export type IdentityResult =
  | {
      readonly principal: RequestPrincipal;
      readonly headers: Readonly<Record<string, string>>;
      /** Minted from the transport and `x-pe-context`; never from a body or page header. */
      readonly caller: Caller;
      readonly setCookie?: string;
      readonly device?: string;
    }
  | { readonly refusal: { readonly code: string; readonly detail: string } };

export interface IdentityOptions {
  readonly devices?: Devices;
  readonly remoteRequests?: WeakSet<object>;
  /** Host-configured addresses. Never inferred from Forwarded or caller-supplied transport headers. */
  readonly remoteIngress?: readonly { origin: string; transport: "lan" | "ssh" }[];
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
  peerAddress?: string,
  remoteOnly = false,
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
  const ingress = options.remoteIngress?.find((entry) => new URL(entry.origin).host === host);
  if (remoteOnly && !ingress)
    return refuse("identity.host", "Use a configured remote origin on the remote listener.");
  const localPeer =
    peerAddress === undefined || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peerAddress);
  if (!localPeer && !ingress)
    return refuse("identity.host", "A network peer must use a configured remote ingress.");
  let result: IdentityResult;
  if (ingress) {
    const share = await options.share.read();
    result =
      share.desired !== "on"
        ? refuse("identity.host", "Remote access is switched off.")
        : origin !== undefined && origin !== new URL(ingress.origin).origin
          ? refuse("identity.origin", "Origin is not the configured remote origin.")
          : Object.keys(headers).some((key) => key.startsWith("tailscale-"))
            ? refuse("identity.forged-proxy", "Tailnet identity is not accepted on this transport.")
            : {
                principal: { kind: "remote", transport: ingress.transport, authority: host },
                headers: {},
                caller: anonymous,
              };
  } else if (host === `127.0.0.1:${options.port()}`) {
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
    const credential = deviceCredential(headers);
    const publicNavigation =
      navigation &&
      (pathname === "/" ||
        /^\/(?:chat|settings|open|machine|design-system|captures)(?:\/|$)/.test(pathname) ||
        /^\/pages\/[^/]+\/?$/.test(pathname));
    const publicAsset =
      (staticResource && (pathname.startsWith("/assets/") || pathname.startsWith("/pages/"))) ||
      (method === "GET" && /^\/captures\/[0-9a-f]{64}\.png$/.test(pathname));
    const pairingDoor = pathname === "/pe/pair" || pathname === "/pe/environment";
    const transport: DeviceTransport =
      result.principal.kind === "tailnet"
        ? "tailnet"
        : result.principal.kind === "remote"
          ? result.principal.transport
          : "ssh";
    let device: ReturnType<Devices["authenticate"]> | undefined;
    if (credential) {
      try {
        if (!options.devices)
          throw new Refused({
            code: "device.unpaired",
            door: pathname,
            reason: "Device pairing is unavailable.",
          });
        device = options.devices.authenticate(
          credential.token,
          transport,
          result.principal.kind === "tailnet" ? result.principal.login : undefined,
        );
        if (device.audience !== credential.audience)
          throw new Refused({
            code: "device.unpaired",
            door: pathname,
            reason: "Device credential has the wrong audience.",
          });
        if (
          device.audience === "mcp" &&
          pathname !== "/mcp" &&
          headers["x-pe-context"] === undefined
        )
          throw new Refused({
            code: "device.unpaired",
            door: pathname,
            reason: "This credential is for the MCP door only.",
          });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        if (!pairingDoor && !publicNavigation && !publicAsset)
          return refuse(error.refusal.code, error.refusal.reason);
        device = undefined;
      }
    }
    const isRemote = result.principal.kind !== "local" || !!credential;
    if (
      isRemote &&
      (matchPeRoute(method, pathname)?.route.localOnly ||
        pathname === BRIDGE_PATH ||
        pathname.startsWith("/admin/"))
    )
      return refuse(
        "identity.local-only",
        "This control is available only to a human at the host.",
      );
    const publicDoor =
      pathname === "/pe/pair" ||
      pathname === "/pe/environment" ||
      pathname === "/mcp" ||
      publicNavigation ||
      publicAsset;
    const minted =
      serviceAuthorized && result.principal.kind === "local"
        ? { caller: { kind: "service", service: hostOwnership.serviceName } as Caller }
        : callerOf(result.principal, headers);
    if (
      device?.audience === "browser" &&
      "caller" in minted &&
      (minted.caller.kind === "anonymous" || minted.caller.kind === "human")
    )
      minted.caller = {
        kind: "human",
        via: transport,
        device: device.id,
        ...(device.login ? { login: device.login } : {}),
      };
    result =
      "refusal" in minted
        ? refuse(minted.refusal.code, minted.refusal.detail)
        : {
            ...result,
            caller: minted.caller,
            device: device?.id,
            headers: {
              ...result.headers,
              ...(credential?.audience === "mcp"
                ? { authorization: `Bearer ${credential.token}` }
                : {}),
            },
          };
    if ("principal" in result) {
      try {
        const share = isRemote ? await options.share.read() : undefined;
        admitRequest(
          result.caller,
          permission,
          `${method} ${pathname}`,
          isRemote && !publicDoor
            ? {
                paired: !!device || result.caller.kind === "external-mcp",
                allowAdministration: share?.allowRemoteAdministration === true,
              }
            : undefined,
        );
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        result = refuse(error.refusal.code, error.refusal.reason);
      }
    }
    if ("principal" in result && !isRemote && navigation && !pathname.startsWith("/pages"))
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
            Option.getOrUndefined(request.remoteAddress),
            options.remoteRequests?.has(request.source),
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
              device: identity.device,
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
