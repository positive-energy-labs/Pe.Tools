import { createServer } from "node:http";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { NodeHttpServer } from "@effect/platform-node";
import { expect } from "vite-plus/test";
import { openBrowser } from "@pe/browser";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { effectTest } from "./effect-test.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { RequestIdentity } from "../src/request-services.ts";
import { hostOwnership } from "../src/host-ownership.ts";

/**
 * The crossing the web's `readmit` (apps/web/src/host/runtime.ts) depends on, on real parts: a real
 * browser, the real admission layer. A tab holding a cookie this host never minted (what a restart
 * leaves) is anonymous and its write is refused; a hidden, script-less frame navigating the origin
 * is admitted as the navigation a fresh load makes, and the same tab's next write is a human's.
 */
effectTest(
  "a tab whose cookie the host forgot is re-admitted by a hidden frame navigation, with no reload",
  () =>
    Effect.gen(function* () {
      const server = createServer();
      yield* Effect.addFinalizer(() => Effect.sync(() => server.closeAllConnections()));
      const port = () => (server.address() as import("node:net").AddressInfo).port;
      const identity = requestIdentityLayer({
        port,
        frontendOrigin: Effect.succeed(undefined),
        share: {
          read: async () => {
            throw Error("local requests never read sharing");
          },
          observe: () => {},
        },
      });
      const routes = Layer.mergeAll(
        // The page says when its script ran, so a frame that booted the app would show.
        HttpRouter.add("GET", "/", () =>
          Effect.succeed(
            HttpServerResponse.html(
              '<!doctype html><title>idle</title><script>document.title = "booted"</script>',
            ),
          ),
        ),
        HttpRouter.add("PUT", "/pe/route-view/fans", () =>
          Effect.gen(function* () {
            return HttpServerResponse.jsonUnsafe({ caller: (yield* RequestIdentity).caller.kind });
          }),
        ),
      );
      yield* Layer.build(
        HttpRouter.serve(routes.pipe(Layer.provide(identity))).pipe(
          Layer.provide(NodeHttpServer.layer(() => server, { host: "127.0.0.1", port: 0 })),
        ),
      );
      yield* Effect.promise(async () => {
        const base = `http://127.0.0.1:${port()}`;
        const browser = await openBrowser({ mode: "headless" });
        try {
          const page = await browser.page();
          await page.send("Page.enable");
          await page.send("Network.enable");
          const loaded = new Promise<void>((resolve) => {
            const stop = page.subscribe((event) => {
              if (event.method === "Page.loadEventFired") (stop(), resolve());
            });
          });
          await page.send("Page.navigate", { url: `${base}/` });
          await loaded;
          const write = async () => {
            const sent = await page.evaluate(
              async (header: string, service: string) => {
                const response = await fetch("/pe/route-view/fans", {
                  method: "PUT",
                  headers: { [header]: service, "content-type": "application/json" },
                  body: "{}",
                });
                return { status: response.status, body: await response.text() };
              },
              HOST_RUNTIME_SERVICE_HEADER,
              hostOwnership.serviceName,
            );
            return { status: sent.status, body: JSON.parse(sent.body) as unknown };
          };
          // A fresh load runs the page's script, and is a human.
          expect(await page.evaluate(() => document.title)).toBe("booted");
          expect(await write()).toEqual({ status: 200, body: { caller: "human" } });

          // The restart, as the tab holds it: the same cookie, with a value this host never minted.
          await page.send("Network.setCookie", {
            name: `pe-browser-${hostOwnership.serviceName}`,
            value: "minted-by-the-host-that-stopped",
            url: base,
            httpOnly: true,
            sameSite: "Strict",
          });
          expect(await write()).toMatchObject({
            status: 403,
            body: { refusal: { code: "context.missing" } },
          });

          // The frame `readmit` makes, attribute for attribute.
          const frame = await page.evaluate(
            () =>
              new Promise<{ ranScript: boolean; pageTitle: string }>((resolve) => {
                document.title = "the page that stayed";
                const frame = document.createElement("iframe");
                frame.hidden = true;
                frame.setAttribute("sandbox", "allow-same-origin");
                frame.addEventListener(
                  "load",
                  () => {
                    const ranScript = frame.contentDocument?.title === "booted";
                    frame.remove();
                    resolve({ ranScript, pageTitle: document.title });
                  },
                  { once: true },
                );
                frame.src = `${window.location.origin}/`;
                document.body.append(frame);
              }),
          );
          // No script ran in the frame, and the page was not reloaded.
          expect(frame).toEqual({ ranScript: false, pageTitle: "the page that stayed" });
          expect(await write()).toEqual({ status: 200, body: { caller: "human" } });
        } finally {
          await browser.close();
        }
      });
    }),
  30_000,
);
