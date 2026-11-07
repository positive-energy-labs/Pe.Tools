import { contextFetch, invocationContext } from "@pe/runtime/context";
import { leaf, read } from "./evaluator.ts";
import { capturesArgs, capturesValue } from "@pe/agent-contracts";

const stored = leaf("captures.store", capturesArgs, capturesValue);
export const reads = {
  browse: read("captures.browse", {
    input: capturesArgs,
    output: capturesValue,
    async run(ctx, args) {
      return ctx.read(stored, args);
    },
  }),
};
export const leaves = {
  "captures.store": async () => {
    const origin = invocationContext()?.hostBaseUrl;
    if (!origin) throw Error("Captures read has no bound host");
    const response = await contextFetch(new URL("/captures", origin));
    if (!response.ok) throw Error(`Retained captures failed (${response.status})`);
    const data = capturesValue.parse(await response.json());
    return { captures: data.captures.sort((a, b) => b.at.localeCompare(a.at)) };
  },
};
