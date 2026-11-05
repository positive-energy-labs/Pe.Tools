import { captureListSchema, type GraphSeedData } from "@pe/agent-contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { solve, type DuctInput } from "#/duct-loss/duct/math";

// TODO: docs/features/routes/LEDGER.md#s7-5d8183e3b5 Link response examples to catalog entries when OpAttribute.Example supports responses.
// It currently projects requestExamples only. Native writes stay refused in the fixture lane.
const at = "2026-11-02T15:00:00Z";
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
export const routeExamples = {
  captures: { readings: { captures }, queries: { "captures.list": captures } },
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
} satisfies Record<string, GraphSeedData<any, any>>;
