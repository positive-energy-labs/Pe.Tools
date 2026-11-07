import { Effect } from "effect";
import { leaf, read } from "./evaluator.ts";
import { capturesArgs, capturesValue } from "@pe/agent-contracts";
import { PictureCaptureStore } from "../captures-route.ts";

const stored = leaf("captures.store", capturesArgs, capturesValue);
export const reads = {
  browse: read("captures.browse", {
    input: capturesArgs,
    output: capturesValue,
    async run(ctx, args) {
      return ctx.read(stored, args);
    },
  }),
};
export const leaves = {
  "captures.store": async () => {
    // SHIM: untracked, recording incomplete. Delete when S binds captures to its resource observer.
    // Replacement: services.take("resource", {kind: "captures"}); never self-HTTP.
    const captures = await Effect.runPromise(
      Effect.flatMap(PictureCaptureStore, (pictures) => Effect.promise(() => pictures.list())).pipe(
        Effect.provide(PictureCaptureStore.layer()),
      ),
    );
    return { captures };
  },
};
