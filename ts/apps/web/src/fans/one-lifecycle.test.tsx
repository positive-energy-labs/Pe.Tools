// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { historySnapshotSchema } from "../shell/history";
import { mountTypedRoute } from "../shell/typed-mount";
import type { ReadingContext } from "../shell/readings";
import { createWitness } from "./cutover.test-support";

test("four Fans panes share their Value and independent roster subscriptions, closed with the typed mount", async () => {
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
    const recordedPage = {...f.typed.page.read(),contextRadiusFt:23};
    const history = historySnapshotSchema.parse({
      point: { id:crypto.randomUUID(),document,at:Date.now(),takingRange:{start:0,end:0},reason:{kind:"captured"},
        history:{address:document,target:{session:"fixture",openId:"fans"},poses:[{instance:"recorded",route:"fans",href:"/fans",page:recordedPage}],publications:[]} },
      work: Object.keys(f.typed.spec.edits.owners).map(id => { const owner=f.typed.owner(id)!;return {handle:owner.handle,revision:owner.handle!.revision,doc:owner.doc}; }),
    });
    const recorded = mountTypedRoute(f.admitted.presenter.typed,{...input,history,readOnly:true,publicationInstance:"recorded",memory:()=>recordedPage},f.admitted.presenter.workFingerprint,{sources:{"fans.sheet":{kind:"use",open}}});
    try {
      expect(recorded.owner()?.ready).toBe(true);
      expect(recorded.page.read().contextRadiusFt).toBe(23);
      expect(recorded.workBasis()).toBeNull();
      expect(recorded.journalRefusal()).toBe("needs live Revit");
      expect(open.mock.calls.at(-1)![0]).toMatchObject({historyPoint:history.point.id,historyPose:{instance:"recorded",route:"fans"}});
      await expect(recorded.run("losses")).rejects.toThrow("needs live Revit");
    } finally { recorded.dispose(); }

  } finally { closes.reverse().forEach(close => close()); }
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(4));
});
