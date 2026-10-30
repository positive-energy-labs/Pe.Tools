import { z } from "zod";
import { Schema } from "effect";
import type { ReadEntry, SettingsRouteDocument } from "@pe/agent-contracts";
import {
  podListResponseSchema,
  podMemberComposeResponseSchema,
  podRunsResponseSchema,
} from "@pe/host-contracts/operation-types";
import type { PluginStatus, PodRouteDescriptor } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { requestJson } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, ReadingScope } from "#/shell/readings";
import type { PodsPage } from "./page";
import {
  draftOf,
  fixturePage,
  readingValue,
  selectedMember,
  type CompositionRead,
  type MemberRead,
} from "./model";
import { DEMO_BROWSE, DEMO_MEMBER_SPECS } from "./seeds";
import { DEMO_RUN } from "#/route/seeds";

const decode = <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S) =>
  z.unknown().transform((value) => Schema.decodeUnknownSync(schema)(value));
const page = (ctx: ReadingContext) => ctx.page as PodsPage;
const work = (ctx: ReadingContext) => ctx.work as SettingsRouteDocument | null;
export interface PluginsRead {
  statuses: PluginStatus[];
  routes: PodRouteDescriptor[];
}

/** Activation stays human-only; this is a host RPC, never an agent semantic command. */
export const activationRpc: ReadEntry<z.ZodObject<{ id: z.ZodString; enabled: z.ZodBoolean }>> = {
  key: "plugin.update",
  input: z.object({ id: z.string().min(1), enabled: z.boolean() }),
  run: ({ id, enabled }) => peClient.call("plugin.update", { params: { id }, body: { enabled } }),
};

export function podsSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "pods.status": {
      kind: "use",
      effects: () => [],
      open(ctx, deliver) {
        if (fixturePage(page(ctx))) return deliver({ kind: "complete", value: null, revision: 0 });
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
        if (fixturePage(page(ctx)))
          return deliver({ kind: "complete", value: DEMO_BROWSE, revision: 0 });
        try {
          const result = await requestJson(
            { path: "/call", body: { key: "pod.list", request: {} } },
            decode(podListResponseSchema),
            ctx.signal,
          );
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
        if (fixturePage(page(ctx))) {
          const fixture = DEMO_MEMBER_SPECS.get(`${ref.pod}|${ref.path}`);
          return deliver({
            kind: "complete",
            value: fixture
              ? {
                  member: ref,
                  content: fixture.content,
                  sha256: "demo",
                  schemaJson: fixture.schema,
                }
              : null,
            revision: 0,
          });
        }
        try {
          const read = await requestJson(
            { path: "/call", body: { key: "pod.member.read", request: ref } },
            z.object({ content: z.string(), sha256: z.string() }),
            ctx.signal,
          );
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
        if (fixturePage(page(ctx)) || !ref || !member || !ref.path.endsWith(".json"))
          return deliver({ kind: "complete", value: null, revision: 0 });
        let draft: string;
        try {
          draft = draftOf({ page: page(ctx), work: work(ctx) }, member);
          JSON.parse(draft);
        } catch {
          return deliver({ kind: "complete", value: null, revision: 0 });
        }
        try {
          const result = await requestJson(
            {
              path: "/call",
              body: { key: "pod.member.compose", request: { ...ref, content: draft } },
            },
            decode(podMemberComposeResponseSchema),
            ctx.signal,
          );
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
        if (fixturePage(page(ctx)))
          return deliver({
            kind: "complete",
            value: path === undefined || path === DEMO_RUN.receipt!.memberPath ? [DEMO_RUN] : [],
            revision: 0,
          });
        if (!pod) return deliver({ kind: "complete", value: [], revision: 0 });
        try {
          const result = await requestJson(
            {
              path: "/call",
              body: { key: "pod.runs", request: { pod, ...(path !== undefined && { path }) } },
            },
            decode(podRunsResponseSchema),
            ctx.signal,
          );
          deliver({ kind: "complete", value: result.runs, revision: 1 });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "pods.plugins": {
      kind: "use",
      effects: () => [],
      async open(ctx, deliver) {
        if (fixturePage(page(ctx))) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const [statuses, routes] = await Promise.all([
            peClient.call("plugins.list", {}),
            peClient.call("plugins.routes", {}),
          ]);
          if (!ctx.signal.aborted)
            deliver({
              kind: "complete",
              value: { statuses, routes } satisfies PluginsRead,
              revision: 1,
            });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
  };
}
