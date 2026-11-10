import { z } from "zod";
import { executionTargetSchema } from "@pe/agent-contracts/target";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";
import type { ReadContext } from "@pe/host/read-graph";
import { fromRevit, size } from "./size.ts";
import { args, firmLimits, key, sizing as sized, value, work } from "./schema.ts";

const stored = z.object({ doc: work }).nullable();
const input = args.extend({ target: executionTargetSchema });
const SAYS = { "no-flow": "carries no design flow", "exceeds-limit": "exceeds a limit at its current size", "no-catalog-size": "has no catalog size within both limits" };

export const sizing = {
  name: `${key}.sizing`,
  input,
  output: value,
  async run(ctx: ReadContext, { system, target }: z.output<typeof input>) {
    if (target.kind !== "document") throw Error("Choose a project document");
    // The target document's Work, the firm file's limit, and two generic catalog reads: no Pod-owned native op.
    const doc = stored.parse(await ctx.work(key, target.ref))?.doc ?? work.parse({});
    const firm = await ctx.firm("hydronic", firmLimits, { maxFriction: 400 });
    const roster = (await ctx.native("mep.system.members", { request: {}, target })).body;
    const chosenSystem = system || roster.systems.find((s) => s.domain === "piping")?.uniqueId;
    if (!chosenSystem) throw Error("This document has no piping system");
    const members = (await ctx.native("mep.system.members", { request: { systemUniqueId: chosenSystem }, target })).body;
    const segments = (await ctx.native("mep.segment.sizes", { request: {}, target })).body;
    const { pipes, catalogs, rooted } = fromRevit(members, segments);
    const limits = { maxVelocity: doc.maxVelocity, maxFriction: doc.maxFriction ?? firm.firm.maxFriction };
    return ctx.compute(value, { limits, chosen: doc.chosen }, (inputs) => {
      const result = { limits: inputs.limits, ...size(pipes, catalogs, inputs.limits, inputs.chosen, rooted) };
      const unresolved = result.unresolved.map((u) => ({
        id: `${u.uniqueId}:${u.kind}`,
        says: `${result.rows.find((r) => r.uniqueId === u.uniqueId)?.label ?? u.uniqueId} ${SAYS[u.kind]}`,
        resolver: "person" as const,
        subject: subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(u.uniqueId) }),
      }));
      return {
        unresolved,
        assumed: firm.present ? [] : [{ id: "firm:maxFriction", says: `Max friction ${limits.maxFriction} Pa/m (no firm file)`, resolver: "person" as const }],
        next: unresolved[0] ?? null,
        inputs: [],
        result: unresolved.length ? { kind: "estimate" as const, value: sized.parse(result), sources: ["current diameters"] } : { kind: "complete" as const, value: sized.parse(result) },
      };
    });
  },
};
export const reads = { sizing };
