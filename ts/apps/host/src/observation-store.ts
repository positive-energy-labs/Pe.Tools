import { Clock, Context, Effect, Layer } from "effect";
import { productPathNames } from "@pe/host-contracts/contracts";
import { type StateDirectory } from "@pe/host-contracts/kinds";
import { join } from "node:path";
import { hostOwnership, hostState } from "./host-ownership.ts";
import { ObservationFiles } from "@pe/host-internal/observation-files";

export { CaptureStoreClosed, type FamiliesObservation } from "@pe/host-internal/observation-files";

export class CaptureStore extends Context.Service<CaptureStore, ObservationFiles>()(
  "pe/CaptureStore",
) {
  static readonly layer = (
    directory: StateDirectory = hostState().directory(
      "host",
      hostOwnership.serviceName,
      // Exception to "generic code names no product" (product-names guard, keptLiterals): this
      // is the on-disk name of every machine's kept Families and schedule readings, and a rename
      // silently drops them, a loss the owner has not ruled on. No other generic file names it.
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
          return new ObservationFiles(directory, apsCachePath, () =>
            new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          );
        }),
        (captures) => Effect.promise(() => captures.close()),
      ),
    );
}
