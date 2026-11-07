// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { historySnapshotSchema } from "../shell/history";
import { mountTypedRoute } from "../shell/typed-mount";
import type { ReadingContext } from "../shell/readings";
import { createWitness } from "./cutover.test-support";

test("typed panes share declared Values; recorded Fans and Ducts use frozen Work and refuse writes", async () => {
  const closes: (() => void)[] = [];
  const stop = vi.fn();
  const open = vi.fn((_ctx: ReadingContext) => stop);
  const document = address("C:/Jobs/History.rvt");
  const f = await createWitness(closes, new Map(), { "fans.sheet": { kind: "use", open } }, {address:document,open:{session:"fixture",openId:"fans"}});
  try {
    for (const pane of Object.keys(f.typed.spec.panes)) f.typed.draw(pane);
    expect(open).toHaveBeenCalledTimes(2);
    expect(stop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.typed.owner()?.ready).toBe(true));
    const input = f.places.get("fans")!;
    for (const route of [f.admitted.presenter,f.admitted.owner]) {
    const recordedPage = {...(route.data.key === "fans" ? f.typed : (f.owner as unknown as {native:typeof f.typed}).native).page.read(),contextRadiusFt:23};
    const history = historySnapshotSchema.parse({
      point: { id:crypto.randomUUID(),document,at:Date.now(),takingRange:{start:0,end:0},reason:{kind:"captured"},
        history:{address:document,target:{session:"fixture",openId:"fans"},poses:[{instance:"recorded",route:route.data.key,href:`/${route.data.key}`,page:recordedPage}],publications:[]} },
      work: Object.keys(f.typed.spec.edits.owners).map(id => { const owner=f.typed.owner(id)!;return {handle:owner.handle,revision:owner.handle!.revision,doc:owner.doc}; }),
    });
    const recorded = mountTypedRoute(route.typed,{...input,history,readOnly:true,publicationInstance:"recorded",memory:()=>recordedPage},route.workFingerprint,{sources:Object.fromEntries([route.typed.spec.core,...Object.values(route.typed.spec.reads ?? {})].map(read=>[read.key,{kind:"use",open}]))});
    try {
      expect(recorded.owner()?.ready).toBe(true);
      expect(recorded.page.read().contextRadiusFt).toBe(23);
      expect(recorded.workBasis()).toBeNull();
      expect(recorded.journalRefusal()).toBe("needs live Revit");
      expect(open.mock.calls.at(-1)![0]).toMatchObject({historyPoint:history.point.id,historyPose:{instance:"recorded",route:route.data.key}});
      await expect(recorded.run("losses")).rejects.toThrow("needs live Revit");
    } finally { recorded.dispose(); expect(recorded.history.entries).toEqual([]); }
    }

  } finally { closes.reverse().forEach(close => close()); }
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(7));
});
