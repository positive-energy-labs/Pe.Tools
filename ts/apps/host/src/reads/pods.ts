import { z } from "zod";
import {
  podMemberSchema,
  memberWork,
  settingsRouteState,
  settingsCandidate,
} from "@pe/agent-contracts";
import { leaf, read } from "./evaluator.ts";
import { composeMember, listPods, listRuns, readMember } from "../settings.ts";
import { runPods } from "../family-actions.ts";
import {
  podsArgs,
  podsValue,
  podsRosterValue,
  podMemberOfPage as member,
} from "@pe/agent-contracts";
import {
  podRowsSchema,
  podRunsSchema,
  memberReadSchema,
  compositionReadSchema,
} from "@pe/agent-contracts";

const inventory = leaf("pods.inventory", z.object({}), podRowsSchema);
const saved = leaf("pods.saved", podMemberSchema, memberReadSchema);
const compose = leaf(
  "pods.compose",
  podMemberSchema.extend({ content: z.string() }),
  compositionReadSchema,
);
const runs = leaf("pods.runs", podMemberSchema.partial({ path: true }), podRunsSchema);
const workValue = z.object({ doc: settingsRouteState.schema }).nullable();
export const reads = {
  roster: read("pods.roster", {
    input: z.object({}),
    output: podsRosterValue,
    async run(ctx) {
      return { pods: await ctx.read(inventory, {}) };
    },
  }),
  author: read("pods.author", {
    input: podsArgs,
    output: podsValue,
    async run(ctx, args) {
      const ref = member(args);
      const selected = ref?.path.endsWith(".json") ? await ctx.read(saved, ref) : null;
      const stored = ref
        ? workValue.parse(
            await ctx.work("pods", {
              route: "pods",
              binding: "workspace",
              target: null,
              work: memberWork(ref),
            }),
          )
        : null;
      const work = stored?.doc ?? null;
      const same = work?.basis?.member.pod === ref?.pod && work?.basis?.member.path === ref?.path;
      const draft =
        same && work?.basis
          ? settingsCandidate(work.basis.rawContent, work.fields)
          : (selected?.content ?? "");
      let composition: z.output<typeof compositionReadSchema> | null = null;
      let json = false;
      let schemaRef: string | null = null;
      try {
        const parsed: unknown = JSON.parse(draft);
        json = true;
        if (
          parsed &&
          typeof parsed === "object" &&
          "$schema" in parsed &&
          typeof parsed.$schema === "string"
        )
          schemaRef = parsed.$schema;
      } catch {
        /* Invalid saved text stays inspectable in the raw editor. */
      }
      if (ref && selected && json)
        composition = await ctx.read(compose, { ...ref, content: draft });
      return {
        scope: args,
        member: selected,
        work,
        draft,
        composition,
        schemaRef,
        runs: args.pod
          ? await ctx.read(runs, {
              pod: args.pod,
              ...(args.runs === "member" && ref ? { path: ref.path } : {}),
            })
          : [],
      };
    },
  }),
};
// SHIM: untracked, recording incomplete. Delete when S admits pod.* host-local native reads.
// Replace runPods calls with services.take("native", {key, request, target: {kind: "host"}}).
export const leaves = {
  "pods.inventory": async () => podRowsSchema.parse((await runPods({}, listPods())).pods),
  "pods.saved": async (raw: unknown) => {
    const ref = podMemberSchema.parse(raw);
    return {
      ...ref,
      member: ref,
      ...(await runPods({}, readMember(ref))),
    };
  },
  "pods.compose": async (raw: unknown) => {
    const { content, ...ref } = compose.input.parse(raw);
    // Host-only composition reports unavailable Revit directives instead of choosing a session.
    return {
      member: ref,
      draft: content,
      result: await runPods({}, composeMember({ ...ref, content })),
    };
  },
  "pods.runs": async (raw: unknown) =>
    podRunsSchema.parse((await runPods({}, listRuns(runs.input.parse(raw)))).runs),
};
