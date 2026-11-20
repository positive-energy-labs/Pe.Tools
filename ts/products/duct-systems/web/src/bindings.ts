import { pricing, type DuctsReads } from "../route.ts";
import { cellMembers, selectedKeys } from "@pe/ducts-web/cell-focus";
import { ductElements } from "@pe/ducts-web/identity";
export function bindings(ctx: DuctsReads) {
  // The systems pane names the roster as its read; the network rides the pricing reading on every pane.
  const priced = ctx.read(pricing),
    snapshot = "value" in priced ? priced.value.network : undefined;
  const elements = ductElements(snapshot),
    selected = selectedKeys(ctx.selection.read().map(({ id }) => id));
  return {
    selected,
    members: cellMembers(selected, elements),
    observation: {
      scope: {
        document: ctx.target?.kind === "document" ? ctx.target.ref : null,
        source: "native" as const,
      },
      references: [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].map(
        ({ id, uniqueId }) => ({ elementId: id, uniqueId }),
      ),
    },
  };
}
