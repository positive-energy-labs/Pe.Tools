import {
  address,
  bindWork,
  familyCaptureSchema,
  parameterLinksBasis,
  parameterLinksRouteState,
  captureListSchema,
  type GraphSeedData,
  type ParameterLinkProfile,
} from "@pe/agent-contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { tableSchema } from "#/data-tables/sources";
import { solve, type DuctInput } from "#/duct-loss/duct/math";
import { solvePage } from "#/grilles/sources";
import type { GrillesPage } from "#/grilles/page";
import { optionKey } from "#/parameter-links/sources";

// TODO: docs/features/routes/LEDGER.md#s7-5d8183e3b5 Link response examples to catalog entries when OpAttribute.Example supports responses.
// It currently projects requestExamples only. Native writes stay refused in the fixture lane.
const at = "2026-11-02T15:00:00Z";
const target = { session: "fixture", openId: "parameter-links" };
const profile: ParameterLinkProfile = {
  formatVersion: 1,
  definitions: [
    {
      id: "supply-flow",
      sourceCategoryId: -2001140,
      sourceParameter: { name: "Flow" },
      sourceScope: "instanceThenType",
      relationship: "sameElement",
      targetParameter: { name: "Design Flow" },
      reducer: "first",
    },
  ],
  assignments: [
    {
      id: "supply-terminals",
      definitionId: "supply-flow",
      enabled: true,
      sourceElementUniqueIds: ["terminal-1", "terminal-2"],
    },
  ],
};
const work = parameterLinksRouteState.schema.parse({ profile: { edit: { value: profile } } });
const links = familyCaptureSchema.parse({
  id: "a".repeat(64),
  key: bindWork("parameter-links", address("C:/Fixtures/Clinic.rvt")),
  capturedAt: at,
  provenance: { kind: "live", target },
  reading: {
    kind: "parameter-links",
    value: {
      basis: parameterLinksBasis(work),
      workRevision: 0,
      evaluated: true,
      subject: "edit",
      stored: profile,
      status: {
        hasStoredProfile: true,
        updaterRegistered: true,
        activeDefinitionCount: 1,
        activeAssignmentCount: 1,
      },
      evaluation: {
        writes: [],
        issues: [],
        changedWriteCount: 0,
        sourceElementCount: 2,
        targetElementCount: 2,
      },
      profileChanged: false,
      appliedWriteCount: 0,
    },
  },
});
const tables = [
  tableSchema.parse({
    name: "Air terminal design flows",
    scheduleId: 601,
    scheduleUniqueId: "fixture-schedule-601",
    columns: [
      { heading: "Mark", kind: "Text", parameterName: "Mark", sharedParameterGuid: "" },
      {
        heading: "Design flow (CFM)",
        kind: "Number",
        parameterName: "Design Flow",
        sharedParameterGuid: "",
      },
    ],
    rows: [
      { key: "sa-1", elementId: 1001, uniqueId: "terminal-1", values: ["SA-1", "450"] },
      { key: "sa-2", elementId: 1002, uniqueId: "terminal-2", values: ["SA-2", "325"] },
    ],
    placements: [{ sheetId: 602, sheetNumber: "M601", sheetName: "Mechanical schedules" }],
  }),
];
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400"><rect width="720" height="400" fill="#faf8ef"/><g fill="none" stroke="#444" stroke-width="3"><path d="M60 60H660V340H60ZM260 60V340M460 60V340"/><path d="M100 190H620M160 190V110M360 190V280M560 190V110" stroke="#3986b5" stroke-width="10"/></g><text x="75" y="385" font-family="sans-serif" font-size="20">Clinic / Level 1 mechanical plan</text></svg>`,
  );
const captures = captureListSchema.parse({
  captures: [
    {
      id: "capture-plan",
      sha: "a".repeat(64),
      at,
      origin: "web:/rooms",
      document: { title: "Clinic", openId: "clinic" },
      view: { id: 101, name: "Level 1 mechanical plan" },
      focus: null,
      registration: null,
      byteSize: 24512,
      url: image,
    },
    {
      id: "capture-terminals",
      sha: "b".repeat(64),
      at: "2026-11-02T14:30:00Z",
      origin: "agent",
      document: { title: "Clinic", openId: "clinic" },
      view: { id: 102, name: "Supply terminals" },
      focus: { elementIds: [1001, 1002] },
      registration: null,
      byteSize: 18020,
      url: image,
    },
  ],
}).captures;
const options: Record<string, unknown> = {};
const option = (key: string, context: Record<string, string>, items: unknown[]) => {
  options[optionKey(key, context)] = { items, status: "ready" };
};
option("category-ids", {}, [{ value: "-2001140", label: "Air Terminals" }]);
option("element-unique-ids", { CategoryId: "-2001140" }, [
  { value: "terminal-1", label: "SA-1" },
  { value: "terminal-2", label: "SA-2" },
]);
const flow = {
  value: "Flow",
  label: "Flow",
  metadata: {
    key: "name:Flow",
    name: "Flow",
    storageType: "Double",
    dataTypeId: "autodesk.spec:airFlow",
  },
};
option(
  "parameter-identities",
  {
    CategoryId: "-2001140",
    ParameterScope: "instanceThenType",
    ElementUniqueIds: "terminal-1\nterminal-2",
  },
  [flow],
);
option("parameter-identities", { CategoryId: "-2001140", ParameterScope: "instance" }, [flow]);
option(
  "parameter-identities",
  {
    CategoryId: "-2001140",
    ParameterScope: "instance",
    WritableOnly: "true",
    StorageType: "Double",
    DataTypeId: "autodesk.spec:airFlow",
  },
  [
    {
      value: "Design Flow",
      label: "Design Flow",
      metadata: { key: "name:Design Flow", name: "Design Flow" },
    },
  ],
);

export const routeExamples = {
  captures: { readings: { captures }, queries: { "captures.list": captures } },
  "data-tables": { readings: { tables }, work: { draft: null } },
  "design-system": { readings: { catalog: { id: "builtin", label: "Design language" } } },
  "duct-loss": {
    page: {
      shape: "round" as const,
      a: 16,
      b: 12,
      cfm: 1200,
      length: 100,
      roughness: 0.0003,
      density: 0.075,
    },
    readings: {
      case: [{ id: "duct", label: "Hypothetical duct case" }],
      result: (page: DuctInput) => solve(page),
    },
  },
  grilles: {
    page: { project: "Clinic lobby floor grilles" },
    readings: { result: (page: GrillesPage) => solvePage(page) },
  },
  ops: {
    target: { kind: "document" as const, ref: { session: "fixture", openId: "clinic" } },
    page: { op: "revit.context.document-session" },
    readings: {
      operation: (page: { op: string }) => hostOpCatalog.find((op) => op.key === page.op) ?? null,
      catalog: { operations: hostOpCatalog },
      receipt: [],
      receipts: [],
    },
    queries: {
      "ops.read": {
        kind: "value",
        value: { documents: [{ title: "Clinic", openId: "clinic" }] },
        elapsedMs: 2,
      },
    },
  },
  "pages-bind": {
    page: { page: "clinic-review", view: false },
    readings: {
      target: {
        page: "clinic-review",
        slot: "default",
        binding: { kind: "pinned", address: "C:/Fixtures/Clinic.rvt" },
        resolution: {
          kind: "resolved",
          target: { kind: "document", ref: { session: "fixture", openId: "clinic" } },
        },
        document: { session: "fixture", openId: "clinic", title: "Clinic" },
        write: null,
      },
      threads: [],
      inventory: {
        sessions: [
          {
            sessionId: "fixture",
            connected: true,
            year: 2025,
            processId: 12345,
            openDocumentCount: 1,
            openDocuments: [
              {
                openId: "clinic",
                title: "Clinic",
                address: "C:/Fixtures/Clinic.rvt",
                isFamilyDocument: false,
              },
            ],
          },
        ],
      },
    },
  },
  "parameter-links": {
    page: { rail: "open" as const },
    work,
    readings: { links: [links], receipts: [], options },
    queries: { "parameter-links.read": links },
  },
} satisfies Record<string, GraphSeedData<any, any>>;
