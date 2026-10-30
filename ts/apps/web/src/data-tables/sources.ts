import { z } from "zod";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { jsonSource } from "#/shell/readings-api";
import { tableSchema } from "./graph";

export function dataTablesSources() {
  return {
    "data-tables.tables": {
      ...jsonSource({
        request: (ctx) =>
          ctx.target.kind === "document"
            ? {
                path: "/call",
                body: { key: "revit.detail.data-tables", request: {} },
                headers: {
                  [HOST_RPC_BRIDGE_SESSION_HEADER]: ctx.target.ref.session,
                  [HOST_RPC_DOCUMENT_HEADER]: ctx.target.ref.openId,
                },
              }
            : null,
        schema: z.object({ tables: z.array(tableSchema) }).transform((value) => value.tables),
        absent: [],
      }),
      dirties: ["data-tables"],
    },
  };
}
