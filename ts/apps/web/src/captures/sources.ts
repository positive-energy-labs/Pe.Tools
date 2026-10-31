import type { ReadingSource } from "#/shell/readings";
import { captureQueries } from "./host";
export function capturesSources(): Record<string, ReadingSource> {
  return {
    "captures.list": {
      kind: "use",
      async open(ctx, deliver) {
        try {
          const value = await captureQueries["captures.list"].run(
            {},
            { target: ctx.target, work: null },
          );
          if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  };
}
