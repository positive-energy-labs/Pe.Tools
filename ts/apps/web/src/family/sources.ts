// Test-only bridge: the protected cells witness supplies its Work directly.
import type { ReadingSource } from "../shell/readings";
import type { GraphMount } from "#/shell/mount";
import type { FamilyPage } from "./page";
import type { FamilyDraft } from "@pe/agent-contracts";
export type FamilyMount=Pick<GraphMount<FamilyPage,FamilyDraft>,"snapshot"|"view"|"control"|"busy"|"registry"|"subscribe"|"version">;
import type { FamilyContext } from "./route";
// Optional acquisitions stay absent. The witness's getSnapshot/write ports own all Work.
const absent: ReadingSource = { kind: "use", open: () => {} };
export const familySources = (): Readonly<Record<string, ReadingSource>> => ({
  "family.profile": absent,
  "family.spec": absent,
  "family.pods": absent,
  "family.receipts": absent,
  "family.captureReceipt": absent,
  "family.buildReceipt": absent,
  "family.test": {
    kind: "use",
    open: (_context, deliver) => deliver({ kind: "complete", value: "current", revision: 0 }),
  },
});

/** CHEAT: frozen witness setup forwards kit handles to its existing owner; no state of its own. */
export const familyWitnessCells = (owner: FamilyMount): Pick<FamilyContext["cells"], "at"> => ({
  at(path) {
    if (path.length !== 2 || path[0] !== "cells") throw Error("Witness only forwards Family cells");
    const key = path[1]!;
    const write = async (edit: unknown) => {
      const work = owner.snapshot().work;
      if (!work) return { code: "not-ready", message: "Read the family first" };
      const result = await owner
        .control("edit", {
          expectedRevision: work.handle.revision,
          patches: [{ path: ["cells", key, "edit"], value: edit }],
        })
        .run();
      return "refusal" in result ? { code: "refused", message: result.refusal.message } : null;
    };
    const cell: ReturnType<FamilyContext["cells"]["at"]> = {
      facts:{},freshness:"current",accept:async()=>{const edit=owner.snapshot().work?.doc.cells[key]?.edit;if(!edit)return {code:"not-staged",message:"Cell is no longer staged"};const {by:_by,at:_at,base:_base,...rung}=edit;return write(rung);},deny:()=>write(null),undo:async()=>({code:"test-only",message:"Witness does not certify keyed undo"}),
      owner: { route: "family", label: "Family" },
      get value() {
        return owner.snapshot().work?.doc.cells[key] ?? {};
      },
      get refusal() {
        return owner.view.read().page.stage === "history" ? "History is inspection only" : null;
      },
      stage: (value) => write({ value }),
      clear: () => write(null),
      transitions: () =>
        !cell.value.edit || cell.refusal ? [] : [{ kind: "clear", run: cell.clear }],
    };
    return cell;
  },
});

/** CHEAT(test-only): protected DocLab setup forwards its real owner, never fabricates Work. */
export function familyWitnessContext(owner:FamilyMount):FamilyContext {
  const work=owner.snapshot().work;
  const at=familyWitnessCells(owner).at;
  return {target:owner.snapshot().target,value:{current:true,status:"ready",value:{handle:work?.handle??null,familyWork:work?.doc}},
    page:{read:()=>owner.view.read().page,pose:(patch:Record<string,unknown>)=>owner.view.setPage(patch),query:(patch:Record<string,unknown>)=>owner.view.setPage(patch)},
    cells:{at,patch:async(patches:import("@pe/agent-contracts").RouteStatePatch[])=>{
      const result=await owner.control("edit",{patches,expectedRevision:work?.handle.revision}).run();
      return "refusal" in result?result.refusal:null;
    }},write:(id:string)=>({run:(input:unknown)=>owner.control(id,input).run()})} as unknown as FamilyContext;
}
