// Test-only boundary: the frozen witness supplies the real Work store and no native capabilities.
import { evaluate } from "@pe/host/reads/evaluator";
import { reads } from "@pe/host/reads/family";
import type { Publication } from "../route/host-read";
import type { MountScope, ExternalTypedMount } from "../shell/mount";
import type { FamilyDraft } from "@pe/agent-contracts";
import type { FamilyPage } from "./page";
import type { FamilyContext } from "./route";
export type FamilyMount = ExternalTypedMount<FamilyPage, FamilyDraft>;
export const familySources = () => ({
  "family.workspace": async (scope: MountScope<FamilyDraft>): Promise<Publication> => {
    const value = await evaluate(reads.workspace, { member: null, target: scope.target }, {
      evaluation: crypto.randomUUID(), origin: { kind: "external-work-witness" },
      revision: () => scope.work?.handle.revision ?? 0,
      async take(name) {
        if (name === "work-scope") return scope.work?.handle.key ?? null;
        if (name === "work") return scope.work ? { doc: scope.work.doc, revision: scope.work.handle.revision } : null;
        if (name === "local:pod.list") return { pods: [], unreadable: [] };
        throw Error(`DocLab witness has no input ${name}`);
      },
    });
    return { key: "family.workspace", generation: 0, version: (scope.work?.handle.revision ?? 0) + 1,
      state: "current", value: { ...value, coverage: { requested: [...value.coverage.requested], covered: [...value.coverage.covered],
        unknown: [...value.coverage.unknown], refused: value.coverage.refused.map(part => ({ keys: [...part.keys], reason: part.reason })) },
        trace: [...value.trace] } };
  },
});
/** Production kit cells and actions, read directly from the typed mount. */
export const familyWitnessContext = (owner: FamilyMount): FamilyContext => owner.context();
