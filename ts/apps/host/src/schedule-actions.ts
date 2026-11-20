import { resolveSdkSession, SdkSession } from "./sdk-session.ts";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  scheduleReadingSchema,
  canonicalRouteInput,
  documentRefSchema,
  addressSchema,
  scheduleReads,
  scheduleGridSnapshotSchema,
  scheduleCatalogSchema,
  type Address,
  type DocumentRef,
  type ScheduleReadKey,
} from "@pe/agent-contracts";
import {
  type RevitDetailSchedules,
  type RevitCatalogSchedules,
} from "@pe/host-contracts/generated";
import { invokeBridge as invoke } from "./bridge.ts";
import { type RevitBridge } from "@pe/host-internal/bridge";
import { refused } from "@pe/host-internal/command-executor";
import type { TakeoffActionDependencies } from "./takeoff-actions.ts";
import { readOriginalProcess, type NativeProcess } from "./native-receipts.ts";
import { type TakeoffCaptures } from "./takeoff-captures.ts";

export const scheduleWorkId = (document: Address, scheduleUniqueId: string) =>
  `schedule:${createHash("sha256")
    .update(canonicalRouteInput([document, scheduleUniqueId]))
    .digest("hex")}`;

async function current(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  process?: NativeProcess,
) {
  // effect-edge: island, phase 5
  const session = await Effect.runPromise(
    SdkSession.resolve(bridge, { session: target.session }).pipe(
      Effect.mapError((error) => refused(error.message)),
    ),
  );
  const doc = session.state?.openDocuments.find((d) => d.openId === target.openId);
  if (
    !doc ||
    doc.isFamilyDocument ||
    (process &&
      (session.processId !== process.pid ||
        session.processStartUtcUnixMs !== Date.parse(process.processStartUtc)))
  )
    throw refused("The exact schedule document lifetime/process is unavailable");
  return { session, doc };
}
export async function readSchedule(
  raw: { key: string; input?: unknown; target?: unknown },
  captures: TakeoffCaptures,
  bridge: RevitBridge["Service"],
  deps: TakeoffActionDependencies = {},
) {
  if (!Object.hasOwn(scheduleReads, raw.key)) throw refused("Unknown schedule read");
  const key = raw.key as ScheduleReadKey;
  if (key === "schedule.grid.saved")
    return captures.schedule(scheduleReads[key].input.parse(raw.input).id);
  if (key === "schedule.grid.history")
    return captures.scheduleHistory(scheduleReads[key].input.parse(raw.input).workspaceId);
  if (key === "schedule.grid.work")
    return captures.scheduleWork(scheduleReads[key].input.parse(raw.input).workspaceId);
  const target = documentRefSchema.parse(raw.target);
  await resolveSdkSession(
    bridge,
    { bridgeSessionId: target.session, openDocumentId: target.openId },
    deps.sdk,
  );
  const { session, doc } = await current(bridge, target);
  if (!session.processId || session.processStartUtcUnixMs == null)
    throw refused("Original process identity unavailable");
  const process = await readOriginalProcess(
    session.processId,
    session.processStartUtcUnixMs,
    deps.sdk,
  );
  await current(bridge, target, process);
  if (key === "schedule.grid.catalog") {
    scheduleReads[key].input.parse(raw.input ?? {});
    const catalog = (await invoke(bridge, target, "revit.catalog.schedules", {
      projection: { view: "Summary" },
      budget: { maxEntries: 500 },
    })) as RevitCatalogSchedules.Res.Response;
    await current(bridge, target, process);
    // An unsaved document has no address, so its schedules have no Work yet (a read refuses too).
    const address = doc.address ? addressSchema.parse(doc.address) : null;
    return scheduleCatalogSchema.parse({
      schedules: catalog.entries
        .filter((e) => !e.isTemplate)
        .map((e) => ({
          scheduleId: e.scheduleId,
          workspaceId:
            address && e.scheduleUniqueId ? scheduleWorkId(address, e.scheduleUniqueId) : null,
          name: e.name,
          categoryName: e.categoryName,
          rowCount: e.visibleBodyRowCount,
          isPlacedOnSheet: e.isPlacedOnSheet,
        })),
    });
  }
  const input = scheduleReads["schedule.grid.snapshot"].input.parse(raw.input ?? {});
  // A reading is filed under its document's address; an unsaved or detached document has none.
  if (!doc.address)
    throw refused(`Save '${doc.title}' to a file before reading its schedules; it has no path.`);
  const document = addressSchema.parse(doc.address);
  const query = {
    ...(input.scheduleId != null
      ? { kind: "ScheduleReferences", scheduleIds: [input.scheduleId] }
      : input.scheduleName
        ? { kind: "ScheduleNames", scheduleNames: [input.scheduleName] }
        : { kind: "CurrentActiveView" }),
    projection: {
      view: "Rows",
      includeColumns: true,
      includeRows: true,
      includeCellValues: true,
      includeBindings: true,
    },
    budget: { maxRowsPerEntry: input.maxRows },
  };
  const response = (await invoke(bridge, target, "revit.detail.schedules", {
    query,
  })) as RevitDetailSchedules.Res.Response;
  if (response.entries.length !== 1) throw refused("Read requires exactly one resolved schedule");
  const entry = response.entries[0]!;
  if (input.scheduleId != null && entry.scheduleId !== input.scheduleId)
    throw refused("Schedule read returned another subject");
  const capturedAt = new Date().toISOString();
  const snapshot = scheduleGridSnapshotSchema.parse({
    ...entry,
    documentTitle: response.documentTitle,
    takenAt: capturedAt,
    truncated: response.page?.isTruncated ?? entry.rows.length >= input.maxRows,
  });
  if (!snapshot.scheduleUniqueId) throw refused("Schedule unique identity is missing");
  const workspaceId = scheduleWorkId(document, snapshot.scheduleUniqueId);
  await current(bridge, target, process);
  const value = {
    target,
    process,
    document,
    workspaceId,
    snapshot,
    capturedAt,
  };
  await current(bridge, target, process);
  return scheduleReadingSchema.parse({
    ...value,
    id: createHash("sha256").update(canonicalRouteInput(value)).digest("hex"),
  });
}
