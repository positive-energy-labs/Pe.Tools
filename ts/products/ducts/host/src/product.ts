import { product } from "@pe/ducts-contract/product";
import { implement } from "@pe/host-internal/product";
import { catalogs } from "./ducts-files.ts";

export const host = implement(product, {
  readings: {
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
