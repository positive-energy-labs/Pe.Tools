import { z } from "zod";
import {
  executionTargetSchema,
  workKeySchema,
  familyDraftSchema,
  podMemberSchema,
  settingsSnapshotSchema,
  parsedDocViewSchema,
} from "@pe/agent-contracts";
import { leaf, read, workValue } from "./evaluator.ts";
import { runPods } from "../family-actions.ts";
import { readMember, composedSpec, listPods } from "../settings.ts";
import { familySpecAsset } from "../family-spec.ts";
import { familyArgs, familyData } from "@pe/agent-contracts";
const scope = leaf(
  "work-scope",
  z.object({ route: z.literal("family"), target: executionTargetSchema }),
  workKeySchema,
  false,
);
const inventory = leaf("family.pods", z.null(), familyData.shape.pods);
const profile = leaf(
  "family.profile",
  podMemberSchema,
  z.object({ profile: settingsSnapshotSchema.nullable(), error: z.string().nullable() }),
);
const spec = leaf(
  "family.spec",
  podMemberSchema,
  z.object({ doc: parsedDocViewSchema.nullable(), error: z.string().nullable() }),
);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const reads = {
  workspace: read("family.workspace", {
    input: familyArgs.extend({ target: executionTargetSchema }),
    output: familyData,
    async run(ctx, args) {
      const target = args.target;
      const key = await ctx.read(scope, { route: "family", target });
      const saved = workValue.parse(await ctx.work("family", key));
      const familyWork = familyDraftSchema.parse(saved?.doc ?? {});
      const loaded = args.member
        ? await ctx.read(profile, args.member)
        : { profile: null, error: null };
      const attached =
        args.member &&
        familyWork.spec?.member.pod === args.member.pod &&
        familyWork.spec.member.path === args.member.path
          ? familyWork.spec
          : null;
      const document =
        args.member && !attached ? await ctx.read(spec, args.member) : { doc: null, error: null };
      return {
        familyWork,
        handle: saved ? { key, revision: saved.revision } : null,
        profile: loaded.profile,
        profileError: loaded.error,
        spec:
          attached ??
          (args.member && document.doc ? { member: args.member, doc: document.doc } : null),
        specError: document.error,
        pods: await ctx.read(inventory, null),
      };
    },
  }),
};
export const leaves = {
  "family.pods": async () => (await runPods({}, listPods())).pods,
  "family.profile": async (raw: unknown) => {
    const member = podMemberSchema.parse(raw);
    try {
      const content = await runPods({}, readMember(member));
      const composed = await runPods({}, composedSpec({ ...member, sha256: content.sha256 }, {}));
      return {
        profile: settingsSnapshotSchema.parse({
          member,
          sha256: content.sha256,
          rawContent: content.content,
          composedContent: composed.spec,
          dependencies: composed.dependencies,
          validation: { isValid: true, issues: [] },
        }),
        error: null,
      };
    } catch (error) {
      return { profile: null, error: message(error) };
    }
  },
  "family.spec": async (raw: unknown) => {
    const member = podMemberSchema.parse(raw);
    const asset = (path: string) =>
      familySpecAsset(
        new URL(`http://host/family/spec?${new URLSearchParams({ ...member, path })}`),
      );
    const link = await asset(`${member.path}.spec.json`);
    if (link.status === 404) return { doc: null, error: null };
    try {
      if (!link.ok) throw Error(await link.text());
      const path = z.object({ path: z.string() }).parse(await link.json()).path;
      const stored = await asset(path);
      if (!stored.ok)
        throw Error(
          `Saved PDF evidence is unavailable (${stored.status}); attach the cut sheet again`,
        );
      return { doc: parsedDocViewSchema.parse(await stored.json()), error: null };
    } catch (error) {
      return { doc: null, error: message(error) };
    }
  },
};
