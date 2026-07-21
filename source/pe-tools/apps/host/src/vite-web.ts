import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse as Response,
} from "effect/unstable/http";
import type { ViteDevServer } from "vite-plus";

export const VITE_HMR_PATH = "/__vite_hmr";

type NodeBackedRequest = HttpServerRequest.HttpServerRequest & {
  readonly source: IncomingMessage;
  readonly resolvedResponse: ServerResponse;
};

// HMR is a WebSocket handled directly on the shared Node server ('upgrade' never reaches the
// router); a plain GET here is a stray client, so answer 426 instead of parking a fiber forever.
const viteHmrRoute = HttpRouter.add(
  "GET",
  VITE_HMR_PATH,
  Effect.succeed(Response.empty({ status: 426 })),
);

function runViteMiddleware(request: HttpServerRequest.HttpServerRequest, vite: ViteDevServer) {
  const nodeRequest = request as NodeBackedRequest;
  const nodeResponse = nodeRequest.resolvedResponse;
  // `source`/`resolvedResponse` are effect/unstable internals, not public contract — fail loudly
  // (not with a hung request) the day a version bump renames them.
  if (!nodeRequest.source || !nodeResponse)
    return Effect.die(
      new Error("vite-web: HttpServerRequest is not Node-backed; effect http internals changed."),
    );

  return Effect.callback<Response.HttpServerResponse, Error>((resume, signal) => {
    let settled = false;
    const finish = (effect: Effect.Effect<Response.HttpServerResponse, Error>) => {
      if (settled) return;
      settled = true;
      nodeResponse.off("finish", onFinished);
      nodeResponse.off("close", onFinished);
      signal.removeEventListener("abort", cleanup);
      resume(effect);
    };
    const cleanup = () => {
      nodeResponse.off("finish", onFinished);
      nodeResponse.off("close", onFinished);
    };
    const onFinished = () =>
      finish(Effect.succeed(Response.empty({ status: nodeResponse.statusCode })));

    signal.addEventListener("abort", cleanup, { once: true });
    nodeResponse.once("finish", onFinished);
    nodeResponse.once("close", onFinished);
    vite.middlewares(nodeRequest.source, nodeResponse, (error?: unknown) => {
      finish(
        error
          ? Effect.fail(
              error instanceof Error
                ? error
                : new Error("Vite middleware failed", { cause: error }),
            )
          : Effect.succeed(Response.empty({ status: 404 })),
      );
    });
  });
}

/** Dev-only final router adapter: product routes win; everything else goes to Vite/TanStack. */
export function viteWebLayer(vite: ViteDevServer) {
  return Layer.mergeAll(
    viteHmrRoute,
    HttpRouter.add("*", "/*", (request) => runViteMiddleware(request, vite)),
  );
}
