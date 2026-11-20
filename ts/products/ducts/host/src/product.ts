import { losses, product } from "@pe/ducts-contract/product";
import { body } from "@pe/host-internal/read-graph";
import { ductsRulingsExecutors } from "./action-runtime.ts";
import { catalogs } from "./ducts-files.ts";

const { snapshot, tables, catalogs: catalog } = product.readings;

export const host = {
  product,
  sheetRecords: { [losses.key]: ductsRulingsExecutors },
  reads: {
    snapshot: body(snapshot.handle, (ctx, { kind: _, target, ...request }) =>
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
    ),
    tables: body(tables.handle, (ctx, { session, ids }) =>
      ctx.native("ducts.tables", {
        role: "acquire",
        target: { kind: "session", session },
        request: { ids },
      }),
    ),
    catalogs: body(catalog.handle, (ctx, { target }) => ctx.read(catalogs, target)),
  },
};
