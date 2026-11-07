import { HostInputContext } from "./input-context.ts";

import { HostNativeRead } from "@pe/host-internal/native-read";
import { Context, Effect, Layer, Option } from "effect";
import { PictureCaptureStore } from "./captures-route.ts";
import { nativeOutputLayer } from "./native-output.ts";
import { HttpRouter } from "effect/http";
import { RevitBridgeLive } from "./bridge.ts";
import { HostNativeReadLive } from "./native-read.ts";
import { NativeReads } from "./native-reads.ts";
import { ReadFreshness } from "./request-services.ts";
import { SdkDriverLive, SdkSession } from "./sdk-session.ts";

/** Build once outside sibling routes, then expose that exact context to each request. */
export const guardedNativeRead = () =>
  Layer.effect(
    HostNativeRead,
    Effect.gen(function* () {
      const reads = yield* HostNativeRead;
      const inputs = yield* HostInputContext;
      return {
        read: (request: Parameters<typeof reads.read>[0]) => {
          const refusal = inputs.check({ kind: "native", key: request.key });
          return refusal ? Effect.fail(refusal) : reads.read(request);
        },
        resolve: (request: Parameters<typeof reads.resolve>[0]) => {
          const refusal = inputs.check({ kind: "native", key: request.key });
          return refusal ? Effect.fail(refusal) : reads.resolve(request);
        },
      };
    }),
  );

export const nativeReadRoot =
  (driver = SdkDriverLive, inputs?: HostInputContext["Service"]) =>
  <A, E, R>(routes: Layer.Layer<A, E, R>) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const source =
          inputs ??
          (yield* HostInputContext.pipe(Effect.provide(HostInputContext.layer({ kind: "live" }))));
        if (source.lane.kind !== "live")
          return yield* Effect.die(Error("Live native root requires a live input graph"));
        const base = yield* Layer.build(
          Layer.mergeAll(
            SdkSession.layer.pipe(Layer.provide(driver)),
            ReadFreshness.layer,
            NativeReads.layer,
          ),
        );
        const backend = HostNativeReadLive.pipe(Layer.provide(Layer.succeedContext(base)));
        const supplied=yield* Effect.serviceOption(PictureCaptureStore);
        const pictures=Option.isSome(supplied)?supplied.value:yield* PictureCaptureStore.pipe(Effect.provide(PictureCaptureStore.layer()));
        const reads = yield* Layer.build(
          guardedNativeRead().pipe(
            Layer.provide(nativeOutputLayer(pictures).pipe(Layer.provide(backend))),
            Layer.provideMerge(Layer.succeed(HostInputContext, source)),
          ),
        );
        const provided = Layer.succeedContext(Context.merge(base, reads));
        return routes.pipe(HttpRouter.provideRequest(provided), Layer.provide(provided));
      }),
    );

/** Recording has no live service requirements; this recipe is never acquired on replay. */
export const liveNativeRecipe = HostNativeReadLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      SdkSession.layer.pipe(Layer.provide(SdkDriverLive)),
      ReadFreshness.layer,
      NativeReads.layer,
    ),
  ),
  Layer.provide(RevitBridgeLive),
);
