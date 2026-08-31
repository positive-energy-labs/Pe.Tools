import * as Atom from "effect/unstable/reactivity/Atom";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  address,
  applyPatches,
  parameterLinksRouteState,
  type ParameterLinkDefinition,
  type ParameterLinkProfile,
  type ParameterLinkValue,
  type ParameterLinksDocument,
  type RouteEnvelope,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { createRouteStoreCore } from "#/state/route-store";

export const fixtureParameterLinksAddress = address("C:\\Fixtures\\parameter-links-review.rvt");

const parameter = (key: string, name: string) => ({
  identity: { key, kind: "NameFallback" as const, name },
});

const definitions: ParameterLinkDefinition[] = [
  {
    id: "airflow-balance",
    sourceCategoryId: -2008013,
    sourceParameter: parameter("Design Airflow", "Design Airflow"),
    sourceScope: "instanceThenType",
    relationship: "sameElement",
    targetParameter: parameter("PE Airflow", "PE Airflow"),
    reducer: "max",
  },
  {
    id: "circuit-connected-load",
    sourceCategoryId: -2001040,
    sourceParameter: parameter("Apparent Load", "Apparent Load"),
    sourceScope: "instance",
    relationship: "electricalEquipmentCircuits",
    targetParameter: parameter("PE Connected Load", "PE Connected Load"),
    reducer: "max",
  },
  {
    id: "pump-design-flow",
    sourceCategoryId: -2001140,
    sourceParameter: parameter("Flow", "Flow"),
    sourceScope: "type",
    relationship: "sameElement",
    targetParameter: parameter("PE Design Flow", "PE Design Flow"),
    targetOverride: {
      enabledParameter: parameter("PE Manual Flow Enabled", "PE Manual Flow Enabled"),
      valueParameter: parameter("PE Manual Flow", "PE Manual Flow"),
    },
    reducer: "first",
  },
  {
    id: "space-cooling-setpoint",
    sourceCategoryId: -2003600,
    sourceParameter: parameter("Cooling Setpoint", "Cooling Setpoint"),
    sourceScope: "instance",
    relationship: "sameElement",
    targetParameter: parameter("PE Cooling Setpoint", "PE Cooling Setpoint"),
    reducer: "min",
  },
];

const draftProfile: ParameterLinkProfile = {
  formatVersion: 1,
  definitions,
  assignments: [
    {
      id: "vav-all",
      definitionId: "airflow-balance",
      enabled: true,
      sourceElementUniqueIds: [],
    },
    {
      id: "vav-level-02-review",
      definitionId: "airflow-balance",
      enabled: false,
      sourceElementUniqueIds: ["vav-2-03", "vav-2-04"],
    },
    {
      id: "panel-lp1",
      definitionId: "circuit-connected-load",
      enabled: true,
      sourceElementUniqueIds: ["panel-lp1"],
    },
    {
      id: "panel-mdp",
      definitionId: "circuit-connected-load",
      enabled: true,
      sourceElementUniqueIds: ["panel-mdp"],
    },
    {
      id: "primary-pumps",
      definitionId: "pump-design-flow",
      enabled: true,
      sourceElementUniqueIds: ["pump-chwp-1", "pump-chwp-2"],
    },
    {
      id: "occupied-spaces",
      definitionId: "space-cooling-setpoint",
      enabled: true,
      sourceElementUniqueIds: [],
    },
  ],
};

const storedProfile: ParameterLinkProfile = {
  ...draftProfile,
  definitions: definitions.slice(0, 3),
  assignments: draftProfile.assignments.slice(0, 4),
};

const value = (displayValue: string, storageType = "Double"): ParameterLinkValue => ({
  storageType,
  displayValue,
});

export const fixtureParameterLinksDocument: ParameterLinksDocument = {
  profile: storedProfile,
  draftProfile,
  evaluation: {
    sourceElementCount: 9,
    targetElementCount: 5,
    changedWriteCount: 3,
    issues: [
      {
        code: "MULTIPLE_SOURCE_VALUES",
        severity: "warning",
        message: "Panel LP-1 circuits report mixed apparent loads; the maximum is proposed.",
        definitionId: "circuit-connected-load",
        assignmentId: "panel-lp1",
      },
      {
        code: "TARGET_PARAMETER_READ_ONLY",
        severity: "error",
        message: "Space 2-118 exposes PE Cooling Setpoint as read-only.",
        definitionId: "space-cooling-setpoint",
        assignmentId: "occupied-spaces",
        targetElementUniqueId: "space-2-118",
      },
    ],
    writes: [
      {
        definitionId: "airflow-balance",
        assignmentId: "vav-all",
        targetElementId: 2103,
        targetElementUniqueId: "vav-2-03",
        targetElementName: "VAV-2-03",
        targetParameter: { key: "PE Airflow", kind: "NameFallback", name: "PE Airflow" },
        currentValue: value("900 CFM"),
        linkedValue: value("1,100 CFM"),
        overrideApplied: false,
        proposedValue: value("1,100 CFM"),
        changed: true,
      },
      {
        definitionId: "airflow-balance",
        assignmentId: "vav-all",
        targetElementId: 2104,
        targetElementUniqueId: "vav-2-04",
        targetElementName: "VAV-2-04",
        targetParameter: { key: "PE Airflow", kind: "NameFallback", name: "PE Airflow" },
        currentValue: value("750 CFM"),
        linkedValue: value("750 CFM"),
        overrideApplied: false,
        proposedValue: value("750 CFM"),
        changed: false,
      },
      {
        definitionId: "circuit-connected-load",
        assignmentId: "panel-lp1",
        targetElementId: 3101,
        targetElementUniqueId: "panel-lp1",
        targetElementName: "Panel LP-1",
        targetParameter: {
          key: "PE Connected Load",
          kind: "NameFallback",
          name: "PE Connected Load",
        },
        currentValue: value("42.0 kVA"),
        linkedValue: value("47.5 kVA"),
        overrideApplied: false,
        proposedValue: value("47.5 kVA"),
        changed: true,
      },
      {
        definitionId: "pump-design-flow",
        assignmentId: "primary-pumps",
        targetElementId: 4101,
        targetElementUniqueId: "pump-chwp-1",
        targetElementName: "CHWP-1",
        targetParameter: {
          key: "PE Design Flow",
          kind: "NameFallback",
          name: "PE Design Flow",
        },
        currentValue: value("550 GPM"),
        linkedValue: value("620 GPM"),
        overrideValue: value("600 GPM"),
        overrideApplied: true,
        proposedValue: value("600 GPM"),
        changed: true,
      },
      {
        definitionId: "pump-design-flow",
        assignmentId: "primary-pumps",
        targetElementId: 4102,
        targetElementUniqueId: "pump-chwp-2",
        targetElementName: "CHWP-2",
        targetParameter: {
          key: "PE Design Flow",
          kind: "NameFallback",
          name: "PE Design Flow",
        },
        currentValue: value("620 GPM"),
        linkedValue: value("620 GPM"),
        overrideApplied: false,
        proposedValue: value("620 GPM"),
        changed: false,
      },
    ],
  },
  status: {
    hasStoredProfile: true,
    updaterRegistered: true,
    activeDefinitionCount: 3,
    activeAssignmentCount: 4,
  },
  profileChanged: true,
  appliedWriteCount: 2,
};

export function createFixtureParameterLinksStore(registry: AtomRegistry.AtomRegistry) {
  let envelope: RouteEnvelope<ParameterLinksDocument> = {
    version: 1,
    revision: 0,
    doc: structuredClone(fixtureParameterLinksDocument),
  };
  const core = createRouteStoreCore("fixture/parameter-links", registry);
  const changed = core.owned("changed", Atom.make(0));
  const slice = core.owned(
    "slice",
    Atom.make((get) => {
      get(changed);
      return envelope;
    }),
  );

  return {
    registry,
    slice,
    atoms: core.verbAtoms,
    apply: (patches: RouteStatePatch[], expectedRevision?: number) =>
      core.runVerb("save draft", async () => {
        const result = applyPatches(
          parameterLinksRouteState,
          envelope,
          "human",
          patches,
          expectedRevision ?? envelope.revision,
        );
        if (!result.ok) return result;
        envelope = result.envelope;
        registry.update(changed, (revision) => revision + 1);
        return { ok: true as const, revision: envelope.revision, doc: envelope.doc };
      }),
    command: (command: string) =>
      core.runVerb(command, async () => ({
        ok: false as const,
        kind: "refused" as const,
        error: "fixture parameter-link commands are disabled",
        hint: "open /parameter-links without source=fixture to use live commands.",
      })),
    dispose: () => core.dispose(),
  };
}
