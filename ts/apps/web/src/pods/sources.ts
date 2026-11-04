import type { SettingsRouteDocument } from "@pe/agent-contracts";

import { callOp } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, ReadingScope } from "#/shell/readings";
import type { PodsPage } from "./page";
import {
  draftOf,
  readingValue,
  selectedMember,
  type CompositionRead,
  type MemberRead,
} from "./model";

const page = (ctx: ReadingContext) => ctx.page as PodsPage;
const work = (ctx: ReadingContext) => ctx.work as SettingsRouteDocument | null;
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
      key: (scope) => (scope.work as SettingsRouteDocument | null)?.basis?.sha256,
      async open(ctx, deliver) {
        const ref = selectedMember(page(ctx));
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
      key: (scope) => (scope as ReadingScope<PodsPage, SettingsRouteDocument>).work?.fields,
      async open(ctx, deliver) {
        const ref = selectedMember(page(ctx));
        const member = readingValue<MemberRead>(ctx.inputs.member);
        if (!ref || !member || !ref.path.endsWith(".json"))
          return deliver({ kind: "complete", value: null, revision: 0 });
        let draft: string;
        try {
          draft = draftOf({ page: page(ctx), work: work(ctx) }, member);
          JSON.parse(draft);
        } catch {
          return deliver({ kind: "complete", value: null, revision: 0 });
        }
        try {
          const result = await callOp({ signal: ctx.signal }, "pod.member.compose", {
            ...ref,
            content: draft,
          });
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
        const ref = selectedMember(page(ctx));
        const pod = ref?.pod || page(ctx).pod;
        const path = page(ctx).runs === "pod" || !ref ? undefined : ref.path;
        if (!pod) return deliver({ kind: "complete", value: [], revision: 0 });
        try {
          const result = await callOp({ signal: ctx.signal }, "pod.runs", {
            pod,
            ...(path !== undefined && { path }),
          });
          deliver({ kind: "complete", value: result.runs, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  };
}
