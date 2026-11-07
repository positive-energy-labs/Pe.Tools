import { z } from "zod";
import type {HostRead} from "../route/host-read.ts";
import type {ReadingContext,UseSource} from "./source-contract.ts";
import type {PeRouteId} from "@pe/agent-contracts/pe-api";
// Transport inspects the frame only; the mount is the sole decoder of Value data.
const publicationFrame=z.looseObject({
  generation:z.number(),version:z.number(),state:z.string(),reason:z.string().optional(),
  value:z.looseObject({evaluation:z.string(),coverage:z.looseObject({
    refused:z.array(z.object({keys:z.array(z.string()),reason:z.string()})),unknown:z.array(z.string()),
  })}).nullable(),
});
/** Browser transport is installed by the shell; declarations carry only the contract and fixtures. */
export function hostReadSource(read:HostRead):UseSource {
  const contract=read,key=read.key;
  return {...read.source,
      async open(ctx: ReadingContext, deliver: Parameters<UseSource["open"]>[1]) {
        const [{ callCompose }, { publicationSource }] = await Promise.all([import("../host/catalog-client.ts"), import("../host/publication-source.ts")]);
        if (ctx.signal.aborted) return;
        return publicationSource({
          async read(context, publication, release) {
            return publicationFrame.parse(await callCompose(context, contract.endpoint ?? (key as PeRouteId), {
                body: {
                  ...publication,
                  release,
                  ...(contract.request ?? ((args) => ({ args })))(
                    contract.input.parse(context.args),
                  ),
                  args: {
                    ...z.record(z.string(), z.unknown()).parse(contract.input.parse(context.args)),
                    target: contract.endpoint !== "reads.value" && context.target?.kind === "document" ? context.target.ref : context.target ?? {kind:"host"},
                  },
                },
              } as never, {
                ...(context.historyPoint ? { "x-pe-history-point": context.historyPoint } : {}),
                ...(context.historyPose ? { "x-pe-history-page": encodeURIComponent(JSON.stringify(context.historyPose)) } : {}),
              }));
          },
        }).open(ctx, deliver);
      },
  };
}
