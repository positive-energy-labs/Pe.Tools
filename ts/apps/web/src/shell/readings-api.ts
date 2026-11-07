import { callCompose, type ComposeInput, type ComposeOutput } from "../host/catalog-client";
import type { PeRouteId } from "@pe/agent-contracts/pe-api";
import type { ReadingContext, UseSource } from "./source-contract";

/** A reading kind `compose`: a catalog route key (ducts roster, sheet, ...), its input, its schema. */
export function composeSource<K extends PeRouteId, T = ComposeOutput<K>>(options: {
  key: K;
  input(context: ReadingContext): ComposeInput<K> | null;
  absent: T;
  map?(response: ComposeOutput<K>): T;
  dirties?: readonly string[];
}): UseSource<T> {
  return {
    kind: "use",
    dirties: options.dirties,
    async open(context, deliver) {
      const input = options.input(context);
      if (input === null) return deliver({ kind: "complete", value: options.absent, revision: 0 });
      try {
        const response = await callCompose(context, options.key, input);
        const value = options.map ? options.map(response) : (response as unknown as T);
        deliver({ kind: "complete", value, revision: 1 });
      } catch (error) {
        if (!context.signal.aborted) deliver({ kind: "failure", error });
      }
    },
  };
}
