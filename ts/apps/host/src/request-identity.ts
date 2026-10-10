import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { BRIDGE_PATH } from "@pe/host-contracts/contracts";
import { withInvocationContext, type RequestPrincipal } from "@pe/mcps/context";
import type { MachineShare } from "@pe/agent-contracts";

export type { RequestPrincipal } from "@pe/mcps/context";
export type IdentityResult =
  | { readonly principal: RequestPrincipal; readonly headers: Readonly<Record<string, string>> }
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
): Promise<IdentityResult> {
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
  const origin = headers.origin;
  const refuse = (code: string, detail: string): IdentityResult => ({ refusal: { code, detail } });
  let result: IdentityResult;
  if (host === `127.0.0.1:${options.port()}`) {
    const proxyIdentity = Object.keys(headers).some((key) => key.startsWith("tailscale-"));
    result = proxyIdentity
      ? refuse("identity.forged-proxy", "Proxy identity is not accepted on the local authority.")
      : origin !== undefined &&
          origin !== `http://127.0.0.1:${options.port()}` &&
          origin !== options.frontendOrigin()
        ? refuse("identity.origin", "Origin is not this host or its recorded checkout frontend.")
        : { principal: { kind: "local" }, headers: origin ? { origin } : {} };
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
      remoteAdministration(pathname, method)
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
  options.share.observe(result, pathname, host);
  return result;
}

/** One boundary for machine control; HTTP/MCP product operations keep their own normal access. */
function remoteAdministration(path: string, method: string): boolean {
  return (
    (method !== "GET" &&
      method !== "HEAD" &&
      (path === "/pe/providers" || path.startsWith("/pe/providers/"))) ||
    (method === "PUT" && path === "/pe/access") ||
    (method === "POST" && path === "/host/update")
  );
}

/** A global router middleware also covers unmatched/static requests and WebSocket upgrades. */
export const requestIdentityLayer = (options: IdentityOptions) =>
  HttpRouter.middleware(
    (handler) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const identity = yield* Effect.promise(() =>
          readRequestIdentity(request.headers, request.originalUrl, options, request.method),
        );
        if ("refusal" in identity) return HttpServerResponse.jsonUnsafe(identity, { status: 403 });
        const services = yield* Effect.context<never>();
        const exit = yield* Effect.promise((signal) =>
          withInvocationContext(
            {
              hostBaseUrl: `http://127.0.0.1:${options.port()}`,
              principal: identity.principal,
              headers: identity.headers,
            },
            () => Effect.runPromiseExitWith(services)(handler, { signal }),
          ),
        );
        return yield* exit;
      }),
    { global: true },
  );
