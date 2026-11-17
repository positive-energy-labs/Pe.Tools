import { valueOf } from "../../../../apps/web/src/route/typed-route.ts";
import { createElement } from "react";
import { kernelPane } from "../../../../apps/web/src/shell/typed-shell.tsx";
import { SheetPane } from "../../../../apps/web/src/route/slots/sheet/pane.tsx";
import { planned, type TypedMount } from "../../../../apps/web/src/shell/typed-mount.ts";
import type { FansRouteDocument } from "@pe/agent-contracts";
import { completion } from "../../../../apps/web/src/shell/work-door-observation.ts";
import type { WorkJournalDoor, WorkWriteOutcome } from "../../../../packages/agent-contracts/src/work-journal-door.ts";

// Old behavior witnesses keep their assertions; only their former admitted-shell test driver changes.
export function nativeTestAdapter(mount: TypedMount, _door: WorkJournalDoor, components: Record<string,any> = {}) {
  const snapshot = (id: string) => {
    if (id.startsWith("owner:")) {
      const record = mount.owner(id.slice(6));
      return record?.ready ? { state: "ready" as const, value: record.doc, handle: record.handle, hash: JSON.stringify(record.doc) }
        : { state: "refused" as const, reason: record?.problem ?? "" };
    }
    if (mount.spec.reads?.[id]) return mount.value(mount.spec.reads[id]);
    const value = mount.value();
    if (valueOf(value) === undefined) return value;
    const data = id === "value" ? {value:{data:valueOf(value)}} : id === "sheet" ? valueOf(value) : valueOf(value)?.[id];
    return {...value,value:data};
  };
  const adapter = {
    ...mount, native: mount, read: (id:string) => {
      // A kernel sheet pane is slot-drawn, as the shell draws it.
      if ((mount.spec.panes[id] as { kernel?: string } | undefined)?.kernel === "sheet")
        return mount.draw(id, (ctx) => createElement(SheetPane, { ctx: { draw: ctx as never, slot: mount.spec.sheet!, field: mount.spec.subject?.field } }));
      // A kernel picture pane too: the shell's own drawing of the slot.
      if ((mount.spec.panes[id] as { kernel?: string } | undefined)?.kernel === "picture") return mount.draw(id, (ctx) => kernelPane(mount, id, ctx));
      const body=mount.draw(id) as {props:{ctx?:unknown}};
      // A value-less read draws the shell's one line, with no body and so no ctx.
      if(!body.props.ctx) return body;
      const Component=components[id];
      return Component ? createElement(Component,{ctx:body.props.ctx}) : body;
    }, close: mount.dispose,
    controls: { subject: mount.page.subject, query: (key:string,value:unknown)=>mount.page.query({[key]:value}) },
    page: { ...mount.page, read: (): Record<string,any> => mount.page.read() },
    work: () => mount.work() as NonNullable<ReturnType<TypedMount["work"]>> & { value: FansRouteDocument },
    subjectState: mount.subjectState,
    workFailure: () => mount.owner()?.failure ?? null,
    reviewRefusal: (id:string)=>mount.reviewProblem(id)?Error(mount.reviewProblem(id)!):null,
    confirm:(id:string)=>{if(mount.review(id)?.stale) throw Error("Review stale");return planned(mount.verb(id)).apply();},
    readingStatus: (id:string)=>({snapshot:snapshot(id)}),
    picker: (_field?: string) => {const value=valueOf(mount.value(mount.spec.subject!.read ?? mount.spec.core));return value ? mount.spec.subject!.options(value) : [];},
    setPaneDemand(_pane: string, _next: boolean) {},
    refresh: (id?: string) => mount.refresh(id ? mount.spec.reads?.[id] ?? mount.spec.core : undefined),
    invoke(id:string,input:any,basis=mount.workBasis()) {
      if (id !== "edit") { void planned(mount.verb(id)).plan().catch(()=>{}); return {kind:"preview"}; }
      if (!basis) throw Error("Work unavailable");
      if(!mount.current(basis)) throw Error("Stale accepted Work basis");
      return completion<WorkWriteOutcome>({kind:"pending"},async()=>{
        const record=mount.owner()!;
        const result = await _door.submitWork(record.scope,{kind:"apply",expectedRevision:basis.workRevision!, patches:input.patches, press:crypto.randomUUID(),...mount.spec.edits!.describe(input.history??{label:"Edit Work"}) as any},basis);
        return await new Promise<WorkWriteOutcome>(resolve=>result.subscribe(value=>{if(value.kind!=="pending") resolve(value);},()=>{}));
      });
    },
  };
  return adapter;
}
