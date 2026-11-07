import { workRead } from "./inputs.ts";

import { executionTargetSchema, familyDraftSchema } from "@pe/agent-contracts";
import { read } from "./evaluator.ts";
import { localRead } from "../local-inputs.ts";
import { familySpec, podProfile } from "../builtin-read-handles.ts";
import { workBinding } from "./inputs.ts";

import { familyArgs, familyData } from "@pe/agent-contracts";
export const reads = {
  workspace: read("family.workspace", {
    input: familyArgs.extend({ target: executionTargetSchema }),
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
      return {
        familyWork,
        handle: saved ? { key, revision: saved.revision } : null,
        profile: loaded.profile,
        profileError: loaded.error,
        spec:
          attached ??
          (args.member && document.doc ? { member: args.member, doc: document.doc } : null),
        specError: document.error,
        pods: (await ctx.read(localRead("pod.list"), {})).pods,
      };
    },
  }),
};
