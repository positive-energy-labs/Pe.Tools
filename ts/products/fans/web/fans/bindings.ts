import type { PictureScope } from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";
import { calc as sheet, type FansDrawContext } from "../route.ts";
import { valueOf } from "../../../../apps/web/src/route/typed-route.ts";
import { cellMembers, selectedKeys } from "@pe/ducts-web/ducts/cell-focus";
import { ductElements } from "@pe/ducts-web/ducts/identity";
export function bindings(ctx:FansDrawContext) {
  // The roster pane names the roster as its read; the open sheet's snapshot rides the sheet reading on every pane.
  const snapshot=valueOf(ctx.read(sheet))?.sheetSnapshot;
  const elements=ductElements(snapshot), selected=selectedKeys(ctx.selection.read().map(({id})=>id));
  return {selected,members:cellMembers(selected,elements),
    observation:{scope:{document:ctx.target?.kind === "document"?ctx.target.ref:null,source:"native" as const},
      references:!snapshot||"kind" in snapshot?[]:[...snapshot.nodes,...snapshot.segments].map(({id,uniqueId})=>({elementId:id,uniqueId}))}};
}

/** The picture's scope (ADR 0035 rule 2): the open fans' walk, as each walked element and fan unit the snapshot names. */
export function fanScope(ctx: FansDrawContext): PictureScope {
  const value = ctx.value.value, snapshot = value?.sheetSnapshot;
  if (!value || !snapshot || "kind" in snapshot) return { kind: "subjects", refs: [] };
  const walked = new Set((value.opened ?? []).flatMap((sheet) => [...(sheet.elements?.walkedElementIds ?? []), ...(sheet.overview.fan ? [sheet.overview.fan.unitId] : [])]));
  return { kind: "subjects", refs: [...snapshot.nodes, ...snapshot.segments].flatMap((element) =>
    walked.has(element.id) && element.uniqueId ? [subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(element.uniqueId) })] : []) };
}
