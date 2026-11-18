import { inputPort, type ReadSources } from "@pe/host/reads/inputs";
import type { RouteWorkspace } from "@pe/runtime";
import { hostMarks } from "../../../../../apps/host/src/document-marks.ts";
import { settle } from "../../../../../apps/host/tests/effect-test.ts";

/** Deterministic native fixtures have no external document events. */
export function calcPort(source: Omit<ReadSources,"file"|"resource"> & { firm:(owner:string)=>Promise<unknown>;catalogs:()=>Promise<unknown> }, workspace: RouteWorkspace, settings: readonly import("@pe/agent-contracts").SettingTierRead[] = []) {
  return inputPort({
    source:{...source,file:async (name,args)=>name === "firm" ? source.firm(String(args)):name === "settings" ? settings:source.catalogs(),resource:async()=>{throw Error("Fixture has no resources");}},
    workspace,
    marks: hostMarks({
      observedSince: 0,
      generation: () => 0,
      changedAt: () => null,
      subscribe: () => () => {},
    }),
    run: settle,
    evaluation: "fixture",
    origin: () => ({ kind: "fixture" }),
    revision: () => 0,
  });
}
