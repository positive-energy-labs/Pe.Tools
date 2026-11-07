import { z } from "zod";
import type {HostRead} from "../route/host-read.ts";
import type {ReadingContext,UseSource} from "./readings.ts";
import type {PeRouteId} from "@pe/agent-contracts/pe-api";
/** Browser transport is installed by the shell; declarations carry only the contract and fixtures. */
export function hostReadSource(read:HostRead):UseSource {
  const contract=read,key=read.key;
  return {...read.source,
      async open(ctx: ReadingContext, deliver: Parameters<UseSource["open"]>[1]) {
        const { callCompose, publicationSource } = await import("../shell/readings-api.ts");
        if (ctx.signal.aborted) return;
        return publicationSource({
          async read(context, publication, release) {
            return contract.output.parse(
              await callCompose(context, contract.endpoint ?? (key as PeRouteId), {
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
              }),
            );
          },
        }).open(ctx, deliver);
      },
  };
}
