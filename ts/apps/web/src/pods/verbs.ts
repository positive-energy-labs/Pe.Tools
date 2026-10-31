import { z } from "zod";
import { podMemberSchema, type SettingsRouteDocument } from "@pe/agent-contracts";
import { commandVerb, pageVerb, rpcVerb, workVerb } from "#/shell/verbs";
import { activationRpc } from "./sources";

const refusal = z.string().nullable().default(null);
const editInput = z.object({ content: z.string(), refusal });
const observeInput = z.object({
  member: podMemberSchema.nullable(),
  sha256: z.string().optional(),
  refusal,
});
const saveInput = z.object({ destination: podMemberSchema.optional(), refusal });
const observe = (replaceEdits: boolean) =>
  commandVerb(
    "settings.observe",
    {
      label: replaceEdits ? "adopt disk bytes" : "open",
      says: replaceEdits
        ? "Discard proposals and edits and adopt the current saved bytes"
        : "Adopt this member's saved bytes as the Work basis",
      review: replaceEdits ? "shown" : "none",
      input: observeInput,
    },
    {
      ready: (_, input) => input.refusal,
      prepare: (_, input) => ({ member: input.member, sha256: input.sha256, replaceEdits }),
      intent: (_, input) => ({ member: input.member!, sha256: input.sha256, replaceEdits }),
      lands: () => ({ pendingDraft: false }),
    },
  );
const save = (asNew: boolean) =>
  commandVerb(
    "settings.write",
    {
      label: asNew ? "save as new" : "save",
      review: "none",
      input: saveInput,
      says: asNew
        ? "Create a sibling member from this reviewed Work; never overwrite a destination"
        : "Save reviewed edits only while the member's saved hash still matches",
    },
    {
      ready: (_, input) => input.refusal,
      intent: (_, input) => (input.destination ? { destination: input.destination } : {}),
      ...(asNew && {
        lands: (result: unknown) => {
          const { pod, path } = z
            .object({ file: podMemberSchema.extend({ sha256: z.string() }) })
            .parse(result).file;
          return { pod, path };
        },
      }),
    },
  );
export const podsVerbs = {
  select: pageVerb(
    { label: "Select member Work", input: podMemberSchema, effect: "query" },
    { page: (_, member) => member },
  ),
  mode: pageVerb(
    { label: "Editor mode", input: z.object({ mode: z.enum(["form", "raw"]) }), effect: "query" },
    { page: (_, input) => input },
  ),
  runs: pageVerb(
    {
      label: "Change run scope",
      input: z.object({ runs: z.enum(["member", "pod"]) }),
      effect: "query",
    },
    { page: (_, input) => input },
  ),
  open: observe(false),
  adopt: observe(true),
  save: save(false),
  "save-new": save(true),
  edit: workVerb(
    { label: "Edit member", input: editInput },
    {
      ready: (_, input) => input.refusal,
      patches: (scope, input) => [
        {
          path: ["fields", ""],
          ...(input.content !==
            (scope.snapshot.work?.doc as SettingsRouteDocument)?.basis?.rawContent && {
            value: { suggestion: null, edit: { value: input.content } },
          }),
        },
      ],
    },
  ),
  activation: rpcVerb(
    activationRpc,
    {
      label: "Change Pod activation",
      caller: "human",
      review: "none",
      input: z.object({ id: z.string(), enabled: z.boolean(), refusal }),
    },
    {
      ready: (_, input) => input.refusal,
      intent: (_, { id, enabled }) => ({ id, enabled }),
      lands: () => ({ pluginEpoch: Date.now() }),
    },
  ),
};
