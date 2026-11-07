import { workRead } from "./inputs.ts";
import { z } from "zod";
import { memberWork, settingsRouteState, settingsCandidate } from "@pe/agent-contracts";
import { read } from "@pe/host/read-graph";
import { localRead } from "../local-inputs.ts";
import {
  podsArgs,
  podsValue,
  podsRosterValue,
  podMemberOfPage as member,
} from "@pe/agent-contracts";
import { compositionReadSchema } from "@pe/agent-contracts";

export const reads = {
  roster: read("pods.roster", {
    input: z.object({}),
    output: podsRosterValue,
    async run(ctx) {
      return { pods: (await ctx.read(localRead("pod.list"), {})).pods };
    },
  }),
  author: read("pods.author", {
    input: podsArgs,
    output: podsValue,
    async run(ctx, args) {
      const ref = member(args);
      const selected = ref?.path.endsWith(".json") ? {member:ref,...await ctx.read(localRead("pod.member.read"), ref)} : null;
      const stored = ref
        ? await ctx.read(workRead("pods", settingsRouteState.schema), {
              route: "pods",
              binding: "workspace",
              target: null,
              work: memberWork(ref),
            })
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
        composition = {member:ref,draft,result:await ctx.read(localRead("pod.member.compose"),{...ref,content:draft})};
      return {
        scope: args,
        member: selected,
        work,
        draft,
        composition,
        schemaRef,
        runs: args.pod
          ? (await ctx.read(localRead("pod.runs"), {
              pod: args.pod,
              ...(args.runs === "member" && ref ? { path: ref.path } : {}),
            })).runs
          : [],
      };
    },
  }),
};
