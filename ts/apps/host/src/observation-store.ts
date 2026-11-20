import { Clock, Context, Effect, Layer } from "effect";
import { productPathNames } from "@pe/host-contracts/contracts";
import { type StateDirectory } from "@pe/host-contracts/kinds";
import { join } from "node:path";
import { hostOwnership, hostState } from "./host-ownership.ts";
import { productGateway } from "./product-executors.generated.ts";

export { CaptureStoreClosed, type FamiliesObservation } from "@pe/host-internal/observation-files";
export const TakeoffCaptures = productGateway.Captures;
export type TakeoffCaptures = InstanceType<typeof TakeoffCaptures>;

export class CaptureStore extends Context.Service<CaptureStore, TakeoffCaptures>()(
  "pe/CaptureStore",
) {
  static readonly layer = (
    directory: StateDirectory = hostState().directory(
      "host",
      hostOwnership.serviceName,
      "takeoff-captures",
    ),
    apsCachePath = join(
      hostOwnership.rootPath,
      productPathNames.stateDirectoryName,
      productPathNames.globalDirectoryName,
      "parameters-service-cache.json",
    ),
  ) =>
    Layer.effect(
      CaptureStore,
      Effect.acquireRelease(
        Effect.gen(function* () {
          const clock = yield* Clock.Clock;
          return new TakeoffCaptures(directory, apsCachePath, () =>
            new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          );
        }),
        (captures) => Effect.promise(() => captures.close()),
      ),
    );
}
