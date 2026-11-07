import { z } from "zod";
import { contextFetch, invocationContext } from "@pe/runtime/context";
import { podMemberSchema, memberWork, settingsRouteState, settingsCandidate } from "@pe/agent-contracts";
import { leaf, read } from "./evaluator.ts";
import { podsArgs, podsValue, podMemberOfPage as member } from "../../../../packages/agent-contracts/src/pods-read.ts";
import { podRowsSchema, podRunsSchema, memberReadSchema, compositionReadSchema } from "../../../../packages/agent-contracts/src/pods-read.ts";

const inventory = leaf("pods.inventory", z.object({}), podRowsSchema);
const saved = leaf("pods.saved", podMemberSchema, memberReadSchema);
const compose = leaf("pods.compose", podMemberSchema.extend({ content: z.string() }), compositionReadSchema);
const runs = leaf("pods.runs", podMemberSchema.partial({ path: true }), podRunsSchema);
const workValue = z.object({ doc: settingsRouteState.schema }).nullable();
export const reads = { author: read("pods.author", {
  input: podsArgs, output: podsValue,
  async run(ctx, args) {
    const pods = await ctx.read(inventory, {}), ref = member(args);
    const selected = ref?.path.endsWith(".json") ? await ctx.read(saved, ref) : null;
    const stored = ref ? workValue.parse(await ctx.work("pods", { route: "pods", binding: "workspace", target: null, work: memberWork(ref) })) : null;
    const work = stored?.doc ?? null;
    const same = work?.basis?.member.pod === ref?.pod && work?.basis?.member.path === ref?.path;
    const draft = same && work?.basis ? settingsCandidate(work.basis.rawContent, work.fields) : selected?.content ?? "";
    let composition: z.output<typeof compositionReadSchema> | null = null;
    if (ref && selected) {
      try { JSON.parse(draft); } catch { return { pods, member: selected, work, draft, composition, runs: args.pod ? await ctx.read(runs, { pod: args.pod, ...(args.runs === "member" && ref ? { path: ref.path } : {}) }) : [] }; }
      composition = await ctx.read(compose, { ...ref, content: draft });
    }
    return { pods, member: selected, work, draft, composition, runs: args.pod ? await ctx.read(runs, { pod: args.pod, ...(args.runs === "member" && ref ? { path: ref.path } : {}) }) : [] };
  },
}) };
// TODO: replace this route-owned self-read adapter with a catalog input handle when S exposes it.
async function call(key: string, request: unknown) {
  const origin = invocationContext()?.hostBaseUrl;
  if (!origin) throw Error("Pod read has no bound host");
  const response = await contextFetch(new URL("/call", origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, request }) });
  if (!response.ok) throw Error(`Pod read ${key} failed (${response.status}): ${await response.text()}`);
  return response.json();
}
export const leaves = {
  "pods.inventory": async () => z.object({ pods: podRowsSchema }).parse(await call("pod.list", {})).pods,
  "pods.saved": async (raw: unknown) => { const ref = podMemberSchema.parse(raw); return { ...ref, member: ref, ...z.object({ content: z.string(), sha256: z.string(), schemaJson: z.string().optional() }).parse(await call("pod.member.read", ref)) }; },
  "pods.compose": async (raw: unknown) => { const { content, ...ref } = compose.input.parse(raw); return { member: ref, draft: content, result: await call("pod.member.compose", raw) }; },
  "pods.runs": async (raw: unknown) => z.object({ runs: podRunsSchema }).parse(await call("pod.runs", raw)).runs,
};
