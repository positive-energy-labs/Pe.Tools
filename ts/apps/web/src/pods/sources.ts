import { compositionReadInput, memberReadInput, runsReadInput } from "./inputs.ts";

import { callOp } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource } from "#/shell/readings";
import { type CompositionRead, type MemberRead } from "./model.ts";

export function podsSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "pods.status": {
      kind: "use",
      effects: () => [],
      open(ctx, deliver) {
        return subscriptionSource({
          request: () => ({ kind: "host-status" }),
          decode: (value) => value,
        }).open(ctx, deliver);
      },
    },
    "pods.list": {
      kind: "use",
      effects: () => [],
      dirties: ["pods"],
      async open(ctx, deliver) {
        try {
          const result = await callOp({ signal: ctx.signal }, "pod.list", {});
          if (!("pods" in result))
            throw Error("pod.list returned identity instead of full inventory");
          deliver({ kind: "complete", value: result.pods, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "pods.member": {
      kind: "use",
      effects: () => [],
      dirties: ["pods"],
      async open(ctx, deliver) {
        const ref = memberReadInput.parse(ctx.args);
        if (!ref || !ref.path.endsWith(".json"))
          return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const read = await callOp({ signal: ctx.signal }, "pod.member.read", ref);
          deliver({
            kind: "complete",
            value: { member: ref, ...read } satisfies MemberRead,
            revision: 1,
            sourceVersion: read.sha256,
          });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "pods.composition": {
      kind: "use",
      dirties: ["pods"],
      async open(ctx, deliver) {
        const input = compositionReadInput.parse(ctx.args);
        if (!input) return deliver({ kind: "complete", value: null, revision: 0 });
        const { content: draft, ...ref } = input;
        try {
          const result = await callOp({ signal: ctx.signal }, "pod.member.compose", input);
          deliver({
            kind: "complete",
            value: { member: ref, draft, result } satisfies CompositionRead,
            revision: 1,
          });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "pods.runs": {
      kind: "use",
      effects: () => [],
      dirties: ["pods"],
      async open(ctx, deliver) {
        const input = runsReadInput.parse(ctx.args);
        if (!input) return deliver({ kind: "complete", value: [], revision: 0 });
        try {
          const result = await callOp({ signal: ctx.signal }, "pod.runs", input);
          deliver({ kind: "complete", value: result.runs, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  };
}
