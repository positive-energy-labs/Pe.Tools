import { createElement } from "react";
import { RosterBody, InputsBody, PictureBody, LedgerBody } from "../ducts/sheet/mount";
import type { TypedMount } from "../shell/typed-mount";
import type { AdmittedMount } from "../shell/admitted-mount";
import type { FansRouteDocument } from "@pe/agent-contracts";
import { completion } from "../shell/work-door-observation";
import type { WorkJournalDoor, WorkWriteOutcome } from "../../../../packages/agent-contracts/src/work-journal-door";

// Old behavior witnesses keep their assertions; only their former admitted-shell test driver changes.
export function nativeTestAdapter(mount: TypedMount, _door: WorkJournalDoor) {
  const snapshot = (id: string) => {
    if (id.startsWith("owner:")) {
      const record = mount.owner(id.slice(6));
      return record?.ready ? { current: true, status: "ready", value: record.doc, handle: record.handle, hash: JSON.stringify(record.doc) }
        : { current: false, status: "unavailable", reason: record?.problem };
    }
    const value = mount.value();
    const data = id === "value" ? {value:{data:value.value}} : id === "sheet" ? value.value : value.value?.[id];
    return {...value,value:data};
  };
  const adapter = {
    ...mount, native: mount, read: (id:string) => {
      const body=mount.draw(id) as {props:{ctx:unknown}};
      const Component=({"sheet-roster":RosterBody,"sheet-inputs":InputsBody,"sheet-picture":PictureBody,"sheet-ledger":LedgerBody} as Record<string,any>)[id];
      return createElement(Component,{ctx:body.props.ctx});
    }, close: mount.dispose,
    controls: { subject: mount.page.subject, query: (key:string,value:unknown)=>mount.page.query({[key]:value}) },
    page: mount.page,
    work: () => mount.work() as ReturnType<AdmittedMount["work"]> & { value: FansRouteDocument },
    subjectState: mount.subjectState,
    workFailure: () => mount.owner()?.failure ?? null,
    history: { get entries() { return mount.owner()?.lease.entry.journal.entries()??[]; },undo:mount.history.undo,redo:mount.history.redo,revert:mount.history.revert },
    reviewRefusal: (id:string)=>mount.reviewProblem(id)?Error(mount.reviewProblem(id)!):null,
    confirm:(id:string)=>{if(mount.review(id)?.stale) throw Error("Review stale");return mount.run(id,true);},
    readingStatus: (id:string)=>({snapshot:snapshot(id)}),
    picker: () => mount.value().value ? mount.spec.subject.options(mount.value().value) : [],
    journal: () => mount.owner()!.lease.entry.journal.read(),
    setPaneDemand() {},
    refresh: mount.refresh,
    invoke(id:string,input:any,basis=mount.workBasis()) {
      if (id !== "edit") { void mount.run(id).catch(()=>{}); return {kind:"preview"}; }
      if (!basis) throw Error("Work unavailable");
      if(!mount.current(basis)) throw Error("Stale accepted Work basis");
      return completion<WorkWriteOutcome>({kind:"pending"},async()=>{
        const record=mount.owner()!;
        const result = await _door.submitWork(record.scope,{kind:"apply",expectedRevision:basis.workRevision!, patches:input.patches, press:crypto.randomUUID(),...mount.spec.edits.describe(input.history??{label:"Edit Work"}) as any},basis);
        return await new Promise<WorkWriteOutcome>(resolve=>result.subscribe(value=>{if(value.kind!=="pending") resolve(value);},()=>{}));
      });
    },
  };
  return adapter as unknown as AdmittedMount & { native: TypedMount; work: typeof adapter.work; page: { read(): Record<string,any> } & TypedMount["page"] };
}
