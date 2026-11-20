import { ductLossData } from "@pe/ducts-contract/duct-loss-read";
import { ductInputError, solve } from "@pe/ducts-domain/duct-loss-math";
import { product } from "@pe/ducts-contract/product";
import { implement } from "@pe/host-internal/product";
import { catalogs, catalogsHome } from "./duct-catalogs.ts";

export const host = implement(product, {
  homes: { catalogs: catalogsHome },
  readings: {
    ductLoss: (ctx, { target: _target, ...args }) =>
      ctx.compute(ductLossData, args, (input) => {
        const error = ductInputError(input);
        return { error, result: error ? null : solve(input) };
      }),
    snapshot: (ctx, { kind: _, target, ...request }) =>
      request.selector.kind === "roster"
        ? ctx.native("ducts.snapshot.roster", {
            role: "acquire",
            target: { kind: "document", ref: target },
            request,
          })
        : ctx.native("ducts.snapshot.walk", {
            role: "acquire",
            target: { kind: "document", ref: target },
            request,
          }),
    tables: (ctx, { session, ids }) =>
      ctx.native("ducts.tables", {
        role: "acquire",
        target: { kind: "session", session },
        request: { ids },
      }),
    catalogs: (ctx, { target }) => ctx.read(catalogs, target),
  },
  commands: {},
});
export const reads = host.reads;
