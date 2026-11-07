import { z } from "zod";
import {
  executionTargetSchema,
  workKeySchema,
  familyDraftSchema,
  podMemberSchema,
  settingsSnapshotSchema,
  parsedDocViewSchema,
} from "@pe/agent-contracts";
import { read, workValue } from "./evaluator.ts";
import { localRead } from "../local-inputs.ts";
import { familySpec, podProfile } from "../builtin-read-handles.ts";
import { workBinding } from "./inputs.ts";
import { readMember, composedSpec, listPods } from "../settings.ts";
import { familySpecAsset } from "../family-spec.ts";
import { familyArgs, familyData } from "@pe/agent-contracts";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const reads = {
  workspace: read("family.workspace", {
    input: familyArgs.extend({ target: executionTargetSchema }),
    output: familyData,
    async run(ctx, args) {
      const target = args.target;
      const key = await ctx.read(workBinding, { route: "family", target });
      const saved = workValue.parse(await ctx.work("family", key));
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
        args.member && !attached ? await ctx.read(familySpec, args.member) : { doc: null, error: null };
      return {
        familyWork,
        handle: saved ? { key, revision: saved.revision } : null,
        profile: loaded.profile,
        profileError: loaded.error,
        spec:
          attached ??
          (args.member && document.doc ? { member: args.member, doc: document.doc } : null),
        specError: document.error,
        pods: (await ctx.read(localRead("pod.list"),{})).pods,
      };
    },
  }),
};
