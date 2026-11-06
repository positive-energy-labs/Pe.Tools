import { createElement } from "react";
import { z } from "zod";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared.ts";
import { INVALID } from "../../../../packages/agent-contracts/src/page-keys.ts";
import { identityCodecs } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import { podsData, podsSchemas, podsEntries, podsNeutralBodies } from "./neutral.ts";
import { Members, Spec, Runs } from "./panes.tsx";
import { podsSources } from "./sources.ts";
import { podsSeeds } from "./graph-seeds.ts";
import { memberId, memberOf } from "./identity.ts";
const source = { module: "pods/kernel.ts", export: "module" };
const bodies = {
  ...podsNeutralBodies,
  browseSeed: {
    slot: "seeds.browse.load",
    kind: "seed",
    source,
    run: () => {
      const seed = podsSeeds.browse;
      return { ...seed, page: { ...seed.page, member: memberId(seed.page) } };
    },
  },
  membersBody: {
    slot: "panes.members.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(Members, ctx),
  },
  specBody: {
    slot: "panes.spec.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(Spec, ctx),
  },
  runsBody: {
    slot: "panes.runs.body",
    kind: "pane",
    source,
    run: (ctx) => createElement(Runs, ctx),
  },
} satisfies BodyBindings<typeof podsData, typeof podsSchemas, typeof podsEntries>;
const textCodec = <S extends z.ZodType>(schema: S) => ({
  encode: (value: z.output<S>) => String(value),
  decode: (text: string) => {
    const parsed = schema.safeParse(text);
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : { ok: false as const, reason: "Invalid Pods field" };
  },
});
export const module = {
  data: podsData,
  schemas: podsSchemas,
  entries: podsEntries,
  bodies,
  sources: podsSources(),
  identities: { local: identityCodecs.local },
  codecs: {
    threadSearch: {
      encode: threadListFields.threadSearch.codec.encode,
      decode: (text: string) => {
        const value = threadListFields.threadSearch.codec.decode(text);
        return value === INVALID
          ? { ok: false as const, reason: "Invalid thread search" }
          : { ok: true as const, value };
      },
    },
    threadSort: textCodec(podsSchemas.threadSort),
    pod: textCodec(podsSchemas.pod),
    path: textCodec(podsSchemas.path),
    runs: textCodec(podsSchemas.runs),
    mode: textCodec(podsSchemas.mode),
    pendingDraft: {
      encode: String,
      decode: (text: string) => ({ ok: true as const, value: text === "true" }),
    },
    member: {
      encode: (id: z.output<typeof podsSchemas.member>) =>
        id ? identityCodecs.local.parts(id).subject : "",
      decode: (text: string) => {
        if (!text) return { ok: true as const, value: null };
        const identity = identityCodecs.local.encode({ namespace: "pods", subject: text });
        return identity.ok && memberOf(identity.value)
          ? identity
          : { ok: false as const, reason: "Invalid Pod member Work" };
      },
    },
  },
};
