import { Effect } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import { peRoutes, servePeRoute } from "@pe/agent-contracts/pe-api";
import { invocationContext } from "@pe/runtime/context";
import { DEVICE_COOKIE, type Devices } from "./remote-device.ts";
import { threadHead, live, Refused, refusalHeaders } from "./control.ts";

export const deviceRoutes = (devices: Devices) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      for (const id of [
        "device.list",
        "device.pair",
        "device.revoke",
        "device.bind",
        "device.claim",
        "device.environment",
      ] as const) {
        const route = peRoutes[id];
        yield* router.add(
          route.method,
          route.path,
          HttpEffect.fromWebHandler((request) =>
            servePeRoute(request, async () => {
              try {
                const context = invocationContext();
                if (id === "device.environment")
                  return Response.json({
                    environmentId: devices.list().environmentId,
                    paired: !!context?.device,
                    local: context?.principal?.kind === "local" && !context.device,
                  });
                if (id === "device.list") {
                  const listing = devices.list();
                  return Response.json({
                    ...listing,
                    sessions: listing.sessions.map((session) => {
                      const head = session.thread ? threadHead(session.thread) : null;
                      const grant = head?.grant;
                      const rw = !!(
                        session.thread &&
                        head &&
                        grant &&
                        !session.revokedAt &&
                        Date.parse(session.expiresAt) > Date.now() &&
                        !live({
                          kind: "grant",
                          device: session.id,
                          thread: session.thread,
                          headRevision: head.revision,
                          lifetime: grant.lifetime,
                        })
                      );
                      return { ...session, rw };
                    }),
                  });
                }
                if (id === "device.pair")
                  return Response.json(
                    devices.pair(peRoutes[id].body.parse(await request.json()).audience),
                    { headers: { "cache-control": "no-store" } },
                  );
                if (id === "device.claim") {
                  const body = peRoutes[id].body.parse(await request.json());
                  const principal = context?.principal;
                  const transport =
                    principal?.kind === "tailnet"
                      ? "tailnet"
                      : principal?.kind === "remote"
                        ? principal.transport
                        : "ssh";
                  const claimed = devices.claim(
                    body.code,
                    body.label,
                    transport,
                    principal?.kind === "tailnet" ? principal.login : undefined,
                  );
                  if (claimed.session.audience === "mcp")
                    return Response.json(claimed, { headers: { "cache-control": "no-store" } });
                  return Response.json(
                    { environmentId: claimed.environmentId, session: claimed.session },
                    {
                      headers: {
                        "set-cookie": `${DEVICE_COOKIE}=${claimed.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(request.url).protocol === "https:" || principal?.kind === "tailnet" ? "; Secure" : ""}`,
                        "cache-control": "no-store",
                      },
                    },
                  );
                }
                const sessionId = decodeURIComponent(
                  new URL(request.url).pathname.split("/").at(-1)!,
                );
                if (id === "device.revoke") devices.revoke(sessionId);
                else {
                  const { thread } = peRoutes["device.bind"].body.parse(await request.json());
                  if (thread && !threadHead(thread))
                    throw new Refused({
                      code: "device.pairing",
                      door: route.path,
                      reason:
                        "Choose an existing thread. Its current head grant is the only write authority.",
                    });
                  devices.bind(sessionId, thread);
                }
                return Response.json({ ok: true });
              } catch (error) {
                if (!(error instanceof Refused)) throw error;
                return Response.json(
                  {
                    error: {
                      code: error.refusal.code,
                      message: error.refusal.reason,
                      details: error.refusal,
                    },
                  },
                  { status: 403, headers: refusalHeaders(error.refusal.code) },
                );
              }
            }),
          ),
        );
      }
    }),
  );
