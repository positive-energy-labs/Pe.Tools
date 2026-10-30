import { scheduleReadingSchema, scheduleGridRouteState } from "@pe/agent-contracts";
import { DEMO_PODS } from "#/route/seeds";
const reading = scheduleReadingSchema.parse({
  id: "a".repeat(64),
  workspaceId: "schedule:fixture",
  target: { session: "fixture", openId: "schedules" },
  document: "C:/Fixtures/Schedules.rvt",
  capturedAt: "2026-10-30T00:00:00Z",
  process: { pid: 1, processStartUtc: "2026-10-30T00:00:00Z", executable: "Fixture" },
  snapshot: {
    scheduleId: 42,
    scheduleUniqueId: "schedule-42",
    scheduleName: "Mechanical equipment",
    columns: [
      { columnNumber: 0, headerText: "Tag", fieldName: "Tag" },
      { columnNumber: 1, headerText: "Model", fieldName: "Model" },
    ],
    rows: [{ rowNumber: 1, values: ["IU-1", "FXMQ15"], subjectIds: [101], bindings: [] }],
  },
});
const seed = {
  title: "Mechanical equipment",
  page: { workspaceId: "schedule:fixture" },
  work: scheduleGridRouteState.schema.parse({ basis: { captureId: reading.id } }),
  readings: {
    catalog: {
      schedules: [
        {
          scheduleId: 42,
          workspaceId: "schedule:fixture",
          name: "Mechanical equipment",
          categoryName: "Equipment",
        },
      ],
    },
    retained: reading,
    saved: null,
    history: [],
    receipts: [],
    outcome: null,
    pods: DEMO_PODS,
  },
  queries: {
    "schedule.grid.snapshot": reading,
    "schedule.grid.bind": {
      envelope: {
        version: 1,
        revision: 0,
        doc: scheduleGridRouteState.schema.parse({ basis: { captureId: reading.id } }),
      },
    },
  },
};
export const schedulesSeeds = { read: seed, apply: seed };
