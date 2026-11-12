import type { PictureScope } from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import type { FansDrawContext } from "./route";
import { cellMembers, selectedKeys } from "../ducts/cell-focus";
import { ductElements } from "../ducts/identity";
export function bindings(ctx:FansDrawContext) {
  const snapshot=ctx.value.value?.sheetSnapshot;
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
