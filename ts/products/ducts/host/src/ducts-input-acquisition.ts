import { documentRefSchema } from "@pe/agent-contracts";
import { ductSlotSourcesSchema } from "@pe/ducts-contract/system-work";
import { ductsDesign, stagedDucts } from "@pe/duct-systems-contract/ducts";
import { native } from "@pe/agent-contracts/handle";
import { read } from "@pe/host-internal/read-graph";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";
import { designLayers } from "./design-layers.ts";
import { acquireSnapshotInputs } from "./ducts-inputs.ts";
const flowSchema = z.object({ slotSources: ductSlotSourcesSchema, slots: z.object({ terminalFlow: z.string() }).catchall(z.string()), coverage: z.array(z.object({ slot: z.string(), covered: z.number(), total: z.number() })), terminalFlow: z.object({ slot: z.string(), ref: z.string() }), terminalFlowNote: z.string().optional() });
export const ductsInputs = read("ducts.inputs", {
  input: documentRefSchema, output: z.object({ snapshot: nativeResponseSchema("ducts.snapshot.roster"), flow: flowSchema, version: z.string().nullable() }),
  async run(ctx, target) {
    const saved = await ctx.read(designLayers, target);
    const design = ductsDesign(saved.ducts, saved.fans), labelParameter = stagedDucts(design, design).labelParameter ?? undefined;
    let version: string | null = null;
    const input = await acquireSnapshotInputs(saved.settings, async slots => {
      const response = await ctx.read(native("ducts.snapshot.roster"), { role: "acquire", target: { kind: "document", ref: target }, request: { ...(Object.keys(slots).length ? { slots } : {}), labelParameter, selector: { kind: "roster" } } });
      version = response.version ?? null;
      return response.body;
    });
    return { ...input, version };
  },
});
