import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import {
  address,
  type Bind,
  type CapabilityCatalog,
  type OpsRouteDocument,
} from "@pe/agent-contracts";

import type { WorldFacts } from "#/host/fleet";
import type { SessionFacts } from "#/host/target";
import type { HostOperationCatalogEntry } from "#/ops/product";

export const OPS_FIXTURE_ADDRESS = address("C:\\Review\\Operations Fixture.rvt");

/** The catalog as `/ops?source=fixture` reviews it: one row per kind, one source silent, no Revit. */
export const OPS_FIXTURE_CAPABILITIES: CapabilityCatalog = {
  at: "2026-08-30T18:42:00.000Z",
  bridgeSessionId: "fixture-26",
  sessions: [
    {
      sessionId: "fixture-26",
      custody: "observed",
      sdkSessionId: "pe.app-26",
      activeDocument: "C:\\Review\\Operations Fixture.rvt",
    },
  ],
  sources: {
    catalog: "ok",
    "route registry": "ok",
    "pod.json": "did not answer: scripting.pod.list timed out after 2000ms",
    skills: "ok",
    sessions: "ok",
  },
  capabilities: [
    {
      key: "op:revit.context.visible-summary",
      kind: "op",
      title: "Visible Model Summary",
      description: "Counts of what the active view shows.",
      needs: "project-document",
      mutates: false,
      actor: "any",
      input: { type: "object" },
      source: "catalog",
      rank: 2,
    },
    {
      key: "route:instances",
      kind: "route-doc",
      title: "Instances",
      description: "Read the Instances document.",
      needs: "nothing",
      mutates: false,
      actor: "any",
      input: {},
      source: "route registry",
      rank: 1,
    },
    {
      key: "route:instances.start",
      kind: "route-command",
      title: "Instances: start",
      description: "Start installed Revit with the staged year and name.",
      needs: "nothing",
      mutates: true,
      actor: "any",
      input: { type: "object" },
      source: "route registry",
      rank: 0,
    },
    {
      key: "route:instances.stop",
      kind: "route-command",
      title: "Instances: stop",
      description: "Stop the selected session.",
      needs: "nothing",
      mutates: true,
      actor: "human",
      input: { type: "object" },
      source: "route registry",
      rank: 0,
    },
    {
      key: "pod:sheets.rename",
      kind: "pod",
      title: "Sheet tools: Rename sheets",
      description: "Pod button the user presses in Revit's Do palette.",
      needs: "document",
      mutates: true,
      actor: "any",
      input: { type: "object" },
      source: "pod.json",
      rank: 1,
    },
    {
      key: "skill:build-pod",
      kind: "skill",
      title: "build-pod",
      description: "Turn a repeated workflow into a shareable Pod.",
      needs: "nothing",
      mutates: false,
      actor: "any",
      input: {},
      source: "skills",
      rank: 0,
    },
  ],
};
export const OPS_FIXTURE_WORLD = "session:fixture-26" as const;
export const OPS_FIXTURE_TARGET = "fixture-26";
export const OPS_FIXTURE_SELECTED = "revit.context.visible-summary";
export const OPS_FIXTURE_REQUEST = {
  maxCategories: 12,
  maxViews: 4,
  includeElementSamples: true,
  detail: "evidence",
};

const operation = (
  key: string,
  displayName: string,
  intent: "read" | "mutate",
  costTier: "cheap" | "moderate" | "expensive",
  needs: "nothing" | "document",
  description: string,
  extra: Partial<HostOperationCatalogEntry> = {},
): HostOperationCatalogEntry => ({
  key,
  displayName,
  intent,
  costTier,
  visibility: "public",
  needs,
  description,
  searchTerms: [],
  requestExamples: [],
  callGuidance: [],
  requestSchemaJson: "{}",
  responseSchemaJson: "{}",
  ...extra,
});

export const OPS_FIXTURE_CATALOG: HostOperationCatalogEntry[] = [
  operation(
    "host.ops.catalog",
    "Host Operation Catalog",
    "read",
    "cheap",
    "nothing",
    "Lists the public operation surface exposed by the Host.",
  ),
  operation(
    OPS_FIXTURE_SELECTED,
    "Visible Model Summary",
    "read",
    "moderate",
    "document",
    "Summarizes visible model categories and representative elements in the active view.",
    {
      requestSchemaJson: JSON.stringify({
        type: "object",
        properties: {
          maxCategories: { type: "integer", title: "Maximum categories" },
          maxViews: { type: "integer", title: "Maximum views" },
          includeElementSamples: { type: "boolean", title: "Include element samples" },
          detail: { type: "string", enum: ["summary", "evidence"] },
        },
      }),
      requestExamples: [
        {
          name: "review",
          description: "Bounded review capture with representative element evidence",
          json: JSON.stringify(OPS_FIXTURE_REQUEST),
        },
      ],
      safeDefaultRequestJson: JSON.stringify({
        maxCategories: 8,
        maxViews: 2,
        includeElementSamples: false,
        detail: "summary",
      }),
    },
  ),
  operation(
    "revit.catalog.project-index",
    "Project Index",
    "read",
    "moderate",
    "document",
    "Indexes project views, sheets, schedules, levels, and model categories.",
  ),
  operation(
    "revit.detail.schedules",
    "Schedule Details",
    "read",
    "expensive",
    "document",
    "Reads rendered schedule columns, rows, placements, and issues.",
  ),
  operation(
    "revit.apply.schedule",
    "Apply Schedule",
    "mutate",
    "expensive",
    "document",
    "Upserts one keyed schedule and prunes rows omitted from the request.",
  ),
  operation(
    "settings.tree",
    "Settings Tree",
    "read",
    "cheap",
    "nothing",
    "Reads the effective settings hierarchy and provenance.",
  ),
];

export const OPS_FIXTURE_SESSION: SessionFacts = {
  sessionId: "bridge-fixture-26",
  sdkSessionId: OPS_FIXTURE_TARGET,
  processId: 26026,
  year: "2026",
  lane: "dev",
  custody: "controlled",
  activeDocumentId: OPS_FIXTURE_ADDRESS,
  activeDocumentTitle: "Operations Fixture",
  openDocumentCount: 2,
  observedAtUnixMs: Date.UTC(2026, 7, 30, 18, 42, 0),
};

export const OPS_FIXTURE_WORLD_FACTS: WorldFacts = {
  id: OPS_FIXTURE_TARGET,
  custody: "controlled",
  phase: "ready",
  detail: "fixture review fact",
  lane: "dev",
  pid: 26026,
  session: OPS_FIXTURE_SESSION,
};

const document: OpsRouteDocument = {
  bindings: {
    op: { id: OPS_FIXTURE_SELECTED, label: "Visible Model Summary" } satisfies Bind,
  },
  receipt: {
    opKey: OPS_FIXTURE_SELECTED,
    request: OPS_FIXTURE_REQUEST,
    value: {
      activeView: { kind: "View", elementId: 9012, label: "Level 2 HVAC Plan" },
      totalVisibleElementCount: 47,
      categories: [
        {
          handle: { kind: "Category", elementId: -2008000, label: "Ducts" },
          elementCount: 18,
          elementHandles: [
            { handle: { kind: "Element", elementId: 220431, label: "Supply Duct" } },
            { handle: { kind: "Element", elementId: 220447, label: "Return Duct" } },
          ],
          isReturnedElementSetComplete: true,
        },
        {
          handle: { kind: "Category", elementId: -2008013, label: "Duct Fittings" },
          elementCount: 16,
          elementHandles: [{ handle: { kind: "Element", elementId: 220512, label: "Elbow" } }],
          isReturnedElementSetComplete: true,
        },
        {
          handle: { kind: "Category", elementId: -2008016, label: "Air Terminals" },
          elementCount: 13,
          elementHandles: [{ handle: { kind: "Element", elementId: 220611, label: "SA-201" } }],
          isReturnedElementSetComplete: false,
        },
      ],
      views: [
        {
          title: "Level 2 HVAC Plan",
          elementCount: 47,
          handle: { kind: "View", elementId: 9012, label: "Level 2 HVAC Plan" },
        },
        {
          title: "Mechanical Coordination",
          elementCount: 31,
          handle: { kind: "View", elementId: 9034, label: "Mechanical Coordination" },
        },
      ],
      issues: [
        {
          severity: "Warning",
          code: "CATEGORY_TRUNCATED",
          message: "Air Terminals returned one representative element.",
        },
      ],
    },
    elapsedMs: 18,
    target: OPS_FIXTURE_TARGET,
    observedAt: "2026-08-30T18:42:00.000Z",
  },
};

export const createOpsFixtureSlice = () =>
  Atom.make(
    AsyncResult.success({
      doc: document,
      revision: 0,
      hydrated: true,
      connected: true,
      error: null,
      peaActive: false,
    }),
  );
