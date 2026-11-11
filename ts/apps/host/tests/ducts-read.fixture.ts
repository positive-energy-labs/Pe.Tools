import { inputPort, type ReadSources } from "../src/reads/inputs.ts";
import type { RouteWorkspace } from "@pe/runtime";
import { hostMarks } from "../src/document-marks.ts";
import { settle } from "./effect-test.ts";

/** Deterministic native fixtures have no external document events. */
export function sheetPort(source: Omit<ReadSources,"file"|"resource"> & { firm:(owner:string)=>Promise<unknown>;catalogs:()=>Promise<unknown> }, workspace: RouteWorkspace) {
  return inputPort({
    source:{...source,file:async (name,args)=>name === "firm" ? source.firm(String(args)):source.catalogs(),resource:async()=>{throw Error("Fixture has no resources");}},
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
