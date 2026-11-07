import { ductsInputPort, type DuctsReadSources } from "../src/reads/ducts-inputs.ts";
import type { RouteWorkspace } from "@pe/runtime";
import { hostMarks } from "../src/document-marks.ts";
import { settle } from "./effect-test.ts";

/** Deterministic native fixtures have no external document events. */
export function sheetPort(source: DuctsReadSources, workspace: RouteWorkspace) {
  return ductsInputPort({
    source,
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
