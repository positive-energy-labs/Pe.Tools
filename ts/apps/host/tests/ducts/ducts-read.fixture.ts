import { documentRefSchema } from "@pe/agent-contracts/target";
import { inputPort, type ReadSources } from "../../src/reads/inputs.ts";
import type { RouteWorkspace } from "@pe/runtime";
import { hostMarks } from "../../src/document-marks.ts";
import { settle } from "../effect-test.ts";

/** Deterministic native fixtures have no external document events. */
export function calcPort(
  source: Omit<ReadSources, "file" | "resource"> & {
    firm: (owner: string) => Promise<unknown>;
    catalogs: (target: import("@pe/agent-contracts").DocumentRef | null) => Promise<unknown>;
  },
  workspace: RouteWorkspace,
  settings: readonly import("@pe/agent-contracts").SettingTierRead[] = [],
) {
  return inputPort({
    source: {
      ...source,
      file: async (name, args) =>
        name === "firm"
          ? source.firm(String(args))
          : name === "settings"
            ? settings
            : source.catalogs(documentRefSchema.nullable().parse(args)),
      resource: async () => {
        throw Error("Fixture has no resources");
      },
    },
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
