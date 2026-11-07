import {z} from "zod";
import {RouteGraphJson} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {BuiltinClosure} from "@pe/agent-contracts";
const member = z.strictObject({ id: z.string(), sha256: z.string() });
export const closureSchema: z.ZodType<{ fingerprint: string; envelope: BuiltinClosure }> = z.strictObject({
  fingerprint: z.string(),
  envelope: z.strictObject({
    source: z.literal("builtin-closure"),
    version: z.literal(1),
    data: RouteGraphJson,
    variants: z.array(z.strictObject({ client: z.enum(["web", "pea"]), entry: z.string() })),
    modules: z.array(member),
    inputs: z.array(member),
    externals: z.array(member),
  }),
});

