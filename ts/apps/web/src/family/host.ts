import { z } from "zod";
import type { Read } from "@pe/host/read-graph";
import { workRead } from "@pe/host/reads/inputs";

import { executionTargetSchema, familyDraftSchema } from "@pe/agent-contracts";
import { read } from "@pe/host/read-graph";
import { localRead } from "@pe/host/local-inputs";
import { familySpec, podProfile } from "@pe/host/builtin-read-handles";
import { workBinding } from "@pe/host/reads/inputs";

import { familyArgs, familyData } from "@pe/agent-contracts";
import { familyGoal } from "./goal.ts";
const workspaceArgs = familyArgs.extend({ target: executionTargetSchema });
export const reads: { workspace: Read<z.output<typeof workspaceArgs>, z.output<typeof familyData>> } = {
  workspace: read("family.workspace", {
    input: workspaceArgs,
    output: familyData,
    async run(ctx, args) {
      const target = args.target;
      const key = await ctx.read(workBinding, { route: "family", target });
      if (!key) throw Error("Family Work binding is unavailable");
      const saved = await ctx.read(workRead("family", familyDraftSchema), key);
      const familyWork = familyDraftSchema.parse(saved?.doc ?? {});
      const loaded = args.member
        ? await ctx.read(podProfile, args.member)
        : { profile: null, error: null };
      const attached =
        args.member &&
        familyWork.spec?.member.pod === args.member.pod &&
        familyWork.spec.member.path === args.member.path
          ? familyWork.spec
          : null;
      const document =
        args.member && !attached
          ? await ctx.read(familySpec, args.member)
          : { doc: null, error: null };
      const spec =
        attached ?? (args.member && document.doc ? { member: args.member, doc: document.doc } : null);
      return {
        ...familyGoal(familyWork, {
          member: !!args.member,
          profileError: loaded.error,
          spec: !!spec,
          specError: document.error,
        }),
        familyWork,
        handle: saved ? { key, revision: saved.revision } : null,
        profile: loaded.profile,
        profileError: loaded.error,
        spec,
        specError: document.error,
        pods: (await ctx.read(localRead("pod.list"), {})).pods,
      };
    },
  }),
};
