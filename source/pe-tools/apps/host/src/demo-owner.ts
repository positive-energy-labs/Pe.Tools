import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createDemoRhvac } from "./demo-rhvac.ts";
import { Context, Effect, Layer } from "effect";
import { HttpEffect, HttpRouter } from "effect/unstable/http";
import {
  address,
  canonicalRouteInput,
  readingKey,
  demoSeedSchema,
  exportSeed,
  importSeed,
  memberWork,
  settingsRouteState,
  takeoffsRouteState,
  familiesRouteState,
  parameterLinksRouteState,
  scheduleGridRouteState,
  type WorkKey,
  type TakeoffSnapshot,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "./action-journal.ts";
import { TakeoffCaptures } from "./takeoff-captures.ts";
import { RevitBridge, BridgeError } from "./bridge.ts";
import { makeCallRoute, type CallRouteDispatch } from "./call-route.ts";
import { assertDemoPath, createDemoSettings } from "./demo-settings.ts";
import { createSettingsCommandHandlers } from "../../../packages/mcps/src/pea/settings-commands.ts";
import { resourceResponse, type ResourceObserver } from "@pe/runtime";
import { hostResourceObserver } from "./resource-adapters.ts";
import { readFamily } from "./family-actions.ts";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";

const unsupported = (key: string) =>
  new BridgeError(`Unsupported demo scenario: ${key}. No native execution.`, 409, {
    notDispatched: true,
  });
const json = (value: unknown, status = 200) => Response.json(value, { status });

/** Native reads the browser reaches through `/call` on a project owner. */
/**
 * What a capture sees but cannot execute. The real engine emits these for every family with a
 * sketch line it cannot name; the member never carries them, the capture's run does.
 */
const SIMULATED_UNMODELED = [
  { reason: "SketchLineUnlocked", path: "$.forms", facts: { simulated: "true" } },
  { reason: "PlaneNotNamed", path: "$.refPlanes.0", facts: { simulated: "true" } },
];

const SIMULATED_READS = ["revit.catalog.loaded-families", "revit.matrix.loaded-families"];

type RunSource = { pod: string; path: string; sha256: string };

/** The simulated project's schedules: supplied facts, never a read of a real model. */
const DEMO_SCHEDULES = [
  { scheduleId: 481223, name: "DX Fan Coil Unit Schedule", categoryName: "Mechanical Equipment" },
  { scheduleId: 481310, name: "Air Terminal Schedule", categoryName: "Air Terminals" },
];
const DEMO_COLUMNS = ["TAG", "REFRIGERANT", "NOTES"];
const DEMO_ROWS = [
  ["IU-1", "R-410A", ""],
  ["IU-2", "R-32", "Ceiling cassette"],
];

/** One loaded family as the matrix and catalog report it; ids are the seed's 1-based order. */
const loadedFamily = (familyId: number, familyName: string) => ({
  familyId,
  familyUniqueId: `demo-family-${familyId}`,
  familyName,
  categoryName: "Mechanical Equipment",
  typeNames: ["Type 1"],
  parameters: [
    {
      definition: {
        identity: { key: "name:PE_G___Model", kind: "NameFallback", name: "PE_G___Model" },
        isInstance: false,
      },
      kind: "FamilyParameter",
      scope: "Family",
      storageType: "String",
      formulaState: "None",
      valuesPerType: { "Type 1": `${familyName} model` },
    },
  ],
  issues: [],
  isPartial: false,
  placedInstanceCount: 1,
});

/** One same-host owner. No production singleton, proxy, SDK process, or environment selection. */
export async function createDemoOwner(parent: string, raw: unknown) {
  const seed = demoSeedSchema.parse(raw);
  if (seed.route === "chat") throw Error("Chat uses the existing simulated session service");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(await assertDemoPath(parent, parent), "instance-"));
  let releaseHandler: (() => Promise<void>) | undefined;
  try {
    const id = `demo-${randomUUID()}`;
    const r10Path = join(root, "demo.r10");
    const rhvac = createDemoRhvac(
      root,
      r10Path,
      id,
      seed.route === "takeoffs" ? seed.readings.rhvac : undefined,
      seed.failure,
    );
    const target = { session: id, openId: `${id}-open` };
    const at = address(join(root, seed.route === "family" ? "demo.rfa" : "demo.rvt"));
    const settings = await createDemoSettings(root);
    const captures = new TakeoffCaptures(join(root, "captures"));
    const journal = new ActionJournal(join(root, "journal.json"));
    const work = new RouteWorkspace({
      registrations: [
        settingsRouteState,
        takeoffsRouteState,
        familiesRouteState,
        parameterLinksRouteState,
        scheduleGridRouteState,
      ].map((spec) => ({
        spec,
        handlers:
          spec.route === settingsRouteState.route
            ? createSettingsCommandHandlers({
                pods: {
                  read: (member) => settings.readMember(member),
                  compose: (request) => settings.composeMember(request),
                },
              })
            : {},
      })),
      store: {
        async getState({ targetKey, route }) {
          try {
            return JSON.parse(
              await readFile(
                join(
                  root,
                  "work",
                  `${createHash("sha256").update(`${targetKey}:${route}`).digest("hex")}.json`,
                ),
                "utf8",
              ),
            ) as unknown;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
          }
        },
        async setState({ targetKey, route, value }) {
          await mkdir(join(root, "work"), { recursive: true });
          await writeFile(
            join(
              root,
              "work",
              `${createHash("sha256").update(`${targetKey}:${route}`).digest("hex")}.json`,
            ),
            JSON.stringify(value),
          );
        },
      },
    });
    // Both route demos are file-free: their inputs are parsed JSON in the seed, never a path.
    const originalFiles =
      seed.route === "family"
        ? seed.readings.files
        : seed.route === "families" || seed.route === "parameter-links"
          ? []
          : seed.files;
    // Seed pod ids are citations; every member lands in this instance's own pod.
    const local = (member: { path: string }) => ({ pod: id, path: member.path });
    const files = originalFiles.map((file) => ({ ...file, member: local(file.member) }));
    // The families profile is supplied JSON; it becomes the member the page confirms.
    if (seed.route === "families")
      files.push({
        member: local(seed.readings.member),
        rawContent: JSON.stringify(seed.readings.profile),
      });
    await settings.ensurePod(id);
    for (const file of files)
      await settings.writeMember({ ...file.member, content: file.rawContent });
    const opened =
      seed.route === "family"
        ? { ...(await settings.readMember(files[0]!.member)), member: files[0]!.member }
        : null;
    const openedPath = opened ? await settings.memberPath(opened.member) : null;
    const scope: WorkKey = opened
      ? { route: settingsRouteState.route, target: null, work: memberWork(opened.member) }
      : { route: seed.route, target: at };
    const route =
      seed.route === "family"
        ? settingsRouteState.route
        : seed.route === "families" || seed.route === "parameter-links"
          ? seed.route
          : "takeoffs";
    const candidate =
      seed.route === "family"
        ? {
            ...seed.work.candidate,
            basis: {
              member: opened!.member,
              rawContent: opened!.content,
              sha256: opened!.sha256,
            },
          }
        : seed.work.candidate;
    const initial = await work.apply(
      scope,
      route,
      "human",
      Object.entries(candidate).map(([key, value]) => ({ path: [key], value })),
      0,
    );
    if (!initial.ok) throw Error(initial.error);
    // A stale plan and a token conflict are the same fact now: the member changed after review.
    if (
      seed.route === "family" &&
      (seed.scenario === "token-conflict" || seed.scenario === "stale-plan")
    )
      await writeFile(openedPath!, `${opened!.content}\n`);
    let snapshot = seed.route === "takeoffs" ? structuredClone(seed.readings.snapshot) : null;
    const localSnapshot = (value: TakeoffSnapshot): TakeoffSnapshot => ({
      ...structuredClone(value),
      reading: { ...value.reading, at, version: id, observedAt: new Date().toISOString() },
      world: {
        ...structuredClone(value.world),
        r10Path,
        zones: value.world.zones.map((zone) => ({
          ...structuredClone(zone),
          rooms: zone.rooms.map((room) => ({
            ...structuredClone(room),
            r10: room.r10 ? { ...room.r10, fileIdentity: rhvac.fileIdentity } : null,
          })),
        })),
      },
    });
    let r10Failed = false;
    let nativeModel = opened?.content ?? "{}";
    let simulatedPlan: { hash: string; spec: string } | undefined;
    // Every owner but `family` holds a project document, so the project engines answer there.
    const project = seed.route !== "family";
    /**
     * The engine files one run per apply in the source pod (dogma law 10). Only an engine writes
     * `output/`, so the simulated engine writes the receipt itself, inside this instance's root.
     */
    const fileRun = async (operation: string, source: RunSource, planHash: string | null) => {
      const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
      const file = await settings.memberPath({
        pod: source.pod,
        path: `output/${runId}/receipt.json`,
      });
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          {
            podId: source.pod,
            memberPath: source.path,
            memberSha256: source.sha256,
            operation,
            planHash,
            outcome: "succeeded",
            outputs: [],
            reason: "simulated demo engine; nothing was written to Revit",
          },
          null,
          2,
        ),
      );
      return file;
    };
    let retired = false;
    let disposal: Promise<void> | undefined;
    const pending = new Set<Promise<Response>>();
    const sessions = [
      {
        sessionId: id,
        connected: true,
        processId: 42,
        processStartUtcUnixMs: 1000,
        custody: "controlled",
        lane: "dev",
        state: {
          openDocuments: [
            {
              openId: target.openId,
              title: "Isolated demo (simulated)",
              address: at,
              isFamilyDocument: seed.route === "family",
              isActive: true,
            },
          ],
        },
      },
    ];
    const bridge = {
      list: Effect.sync(() => sessions),
      subscribe: () => () => {},
      invoke: (key: string, input: unknown, session?: string, openId?: string) =>
        Effect.tryPromise({
          try: async () => {
            if (retired || session !== id) throw unsupported("production destination");
            // The session catalog `/call` consults before a read: only the reads this owner simulates.
            if (key === "host.ops.catalog" && openId === null)
              return {
                value: {
                  operations: SIMULATED_READS.map((read) => ({
                    key: read,
                    intent: "Read",
                    needs: "project-document",
                  })),
                },
                target: { session: id, document: at },
              };
            if (openId !== target.openId) throw unsupported("production destination");
            let value: unknown;
            if (key === "takeoffs.initialize-carrier" && seed.route === "takeoffs")
              value = { remaining: [], simulated: true };
            else if (
              key === "takeoffs.adopt" &&
              seed.route === "takeoffs" &&
              seed.readings.afterAdopt
            ) {
              if (seed.failure.kind === "refusal") throw unsupported(seed.failure.message);
              snapshot = structuredClone(seed.readings.afterAdopt);
              value = { adopted: (input as { items: unknown[] }).items, simulated: true };
            } else if (
              key === "takeoffs.partition" &&
              seed.route === "takeoffs" &&
              seed.readings.partition
            ) {
              if (seed.failure.kind === "refusal") throw unsupported(seed.failure.message);
              if (seed.failure.kind === "unknown") throw new BridgeError(seed.failure.message, 503);
              value = {
                ...structuredClone(seed.readings.partition),
                simulated: true,
                review: seed.readings.partition.review
                  ? {
                      ...seed.readings.partition.review,
                      source: {
                        runId: (input as { runId: string }).runId,
                        documentKey: at,
                        targetKey: id,
                      },
                    }
                  : null,
              };
              if (seed.readings.afterPartition)
                snapshot = structuredClone(seed.readings.afterPartition);
            } else if (key === "takeoffs.rhvac-links" && seed.route === "takeoffs") {
              const writes = (
                input as {
                  writes: {
                    elementId: number;
                    link: NonNullable<
                      TakeoffSnapshot["world"]["zones"][number]["rooms"][number]["r10"]
                    >;
                  }[];
                }
              ).writes;
              // Simulated native link write only; room identity and link contents are production executor output.
              for (const room of snapshot!.world.zones.flatMap((zone) => zone.rooms)) {
                const write = writes.find((write) => write.elementId === room.elementId);
                if (write) room.r10 = write.link;
              }
              value = { simulated: true, writes };
            } else if (key === "settings.schema") {
              value = { schemaJson: "", simulated: true };
            } else if (key === "families.plan" && seed.route === "families") {
              const spec = (input as { specJson: string }).specJson;
              const planned = { hash: createHash("sha256").update(spec).digest("hex"), spec };
              simulatedPlan = planned;
              value = {
                diagnostics: [],
                // The engine plans exactly the ids the target resolved.
                families: (input as { familyIds: number[] }).familyIds.map((familyId) => ({
                  familyId,
                  familyName: seed.readings.families[familyId - 1],
                  planHash: `${planned.hash}:${familyId}`,
                  changes: [{ section: "types", key: "Width", kind: "set" }],
                  runEffects: [],
                  warnings: [],
                  refusals:
                    seed.scenario === "plan-refusal"
                      ? [
                          {
                            code: "DemoRefusal",
                            path: "/",
                            message: "Supplied simulated native refusal",
                          },
                        ]
                      : [],
                })),
                simulated: true,
              };
            } else if (key === "families.apply" && seed.route === "families") {
              const expected = (input as { expectedPlanHashes: Record<string, string> })
                .expectedPlanHashes;
              if (!simulatedPlan || !Object.keys(expected).length)
                throw new BridgeError("No reviewed simulated plan", 409, { notDispatched: true });
              value = {
                receiptPath: await fileRun(
                  "families.apply",
                  (input as { source: RunSource }).source,
                  simulatedPlan.hash,
                ),
                diagnostics: [],
                receipts: Object.entries(expected).map(([familyId, planHash]) => ({
                  familyId: Number(familyId),
                  familyName: seed.readings.families[Number(familyId) - 1] ?? "demo",
                  success: true,
                  converged: true,
                  planHash,
                  residue: [],
                  errors: [],
                  artifactDirectory: join(root, "artifacts", familyId),
                })),
                simulated: true,
              };
            } else if (
              (key === "revit.detail.parameter-links" || key === "revit.apply.parameter-links") &&
              seed.route === "parameter-links"
            ) {
              const evaluating = key === "revit.apply.parameter-links";
              const profile = evaluating
                ? (input as { profile: unknown }).profile
                : (seed.readings.stored ?? null);
              value = {
                profile,
                status: {
                  hasStoredProfile: seed.readings.stored != null,
                  updaterRegistered: true,
                  activeDefinitionCount: seed.readings.stored?.definitions.length ?? 0,
                  activeAssignmentCount: seed.readings.stored?.assignments.length ?? 0,
                },
                evaluation: evaluating
                  ? {
                      writes: [],
                      issues: seed.readings.blockingIssue
                        ? [
                            {
                              code: "DemoBlocked",
                              severity: "error",
                              message: "Supplied simulated blocking issue",
                            },
                          ]
                        : [],
                      sourceElementCount: seed.readings.changedWriteCount,
                      targetElementCount: seed.readings.changedWriteCount,
                      changedWriteCount: seed.readings.changedWriteCount,
                    }
                  : null,
                profileChanged: true,
                appliedWriteCount:
                  evaluating && !(input as { previewOnly?: boolean }).previewOnly
                    ? seed.readings.changedWriteCount
                    : 0,
                simulated: true,
              };
            } else if (key === "family.capture" && seed.route === "family") {
              value = {
                reading: { at, version: null, observedAt: new Date().toISOString() },
                familyName: "Simulated demo family",
                // The native engine captures a bare model; the host names what it is. A real capture
                // always sees facts it cannot execute, so the simulation does too.
                modelJson: JSON.stringify({
                  ...JSON.parse(nativeModel),
                  $schema: undefined,
                  unmodeled: SIMULATED_UNMODELED,
                }),
                unmodeledCount: SIMULATED_UNMODELED.length,
                coverage: { simulation: "Supplied demo model only; no native capture" },
                issues: [],
                simulated: true,
              };
            } else if (key === "family.plan" && seed.route === "family") {
              if (seed.scenario === "plan-refusal")
                throw unsupported("Supplied simulated native refusal");
              const spec = (input as { specJson: string }).specJson;
              simulatedPlan = { hash: createHash("sha256").update(spec).digest("hex"), spec };
              value = {
                diagnostics: [],
                families: [
                  {
                    familyId: 1,
                    familyName: "Simulated demo family",
                    planHash: simulatedPlan.hash,
                    changes: [],
                    runEffects: ["Simulated outcome only"],
                    refusals: [],
                    warnings: [],
                  },
                ],
                simulated: true,
              };
            } else if (key === "family.apply" && seed.route === "family") {
              const expected = Object.values(
                (input as { expectedPlanHashes: Record<string, string> }).expectedPlanHashes,
              );
              if (!simulatedPlan || expected.length !== 1 || expected[0] !== simulatedPlan.hash)
                throw unsupported("simulated native plan changed");
              const planned = JSON.parse(simulatedPlan.spec) as { patch?: unknown };
              nativeModel = planned.patch ? JSON.stringify(planned.patch) : simulatedPlan.spec;
              value = {
                diagnostics: [],
                receipts: [
                  {
                    familyId: 1,
                    familyName: "Simulated demo family",
                    success: true,
                    converged: true,
                    planHash: simulatedPlan.hash,
                    residue: [],
                    errors: [],
                    artifactDirectory: null,
                  },
                ],
                receiptPath: await fileRun(
                  "family.apply",
                  (input as { source: RunSource }).source,
                  simulatedPlan.hash,
                ),
                simulated: true,
                proof: "No Revit mutation or RFA output; the run receipt is simulated",
              };
            } else if (key === "schedule.apply" && project) {
              const { source } = input as { source: RunSource };
              value = {
                scheduleId: 900001,
                scheduleName: "Simulated demo schedule",
                appliedFieldCount: 3,
                skipped: [],
                warnings: [],
                receiptPath: await fileRun("schedule.apply", source, null),
                simulated: true,
              };
            } else if (key === "schedule.capture" && project) {
              const schedule = DEMO_SCHEDULES.find(
                (row) => row.scheduleId === (input as { scheduleId: number }).scheduleId,
              );
              if (!schedule) throw unsupported("unknown simulated schedule");
              value = {
                reading: { at, version: null, observedAt: new Date().toISOString() },
                scheduleName: schedule.name,
                specJson: JSON.stringify({
                  $schema: `${hostProcessIdentity.defaultHostBaseUrl}/schemas/settings/CmdScheduleManager/schedules.json`,
                  Name: schedule.name,
                  CategoryName: schedule.categoryName,
                  Fields: DEMO_COLUMNS.map((column) => ({ ParameterName: column })),
                }),
                simulated: true,
              };
            } else if (key === "revit.catalog.schedules" && project) {
              value = {
                entries: DEMO_SCHEDULES.map((row) => ({
                  ...row,
                  isTemplate: false,
                  visibleBodyRowCount: DEMO_ROWS.length,
                  isPlacedOnSheet: true,
                })),
                simulated: true,
              };
            } else if (key === "revit.detail.schedules" && project) {
              const query = (input as { query: { scheduleIds?: number[] } }).query;
              const schedule =
                DEMO_SCHEDULES.find((row) => row.scheduleId === query.scheduleIds?.[0]) ??
                DEMO_SCHEDULES[0]!;
              value = {
                documentTitle: "Isolated demo (simulated)",
                entries: [
                  {
                    scheduleId: schedule.scheduleId,
                    scheduleUniqueId: `demo-schedule-${schedule.scheduleId}`,
                    scheduleName: schedule.name,
                    columns: DEMO_COLUMNS.map((fieldName, columnNumber) => ({
                      columnNumber,
                      headerText: fieldName,
                      fieldName,
                    })),
                    rows: DEMO_ROWS.map((values, index) => ({
                      rowNumber: index + 1,
                      values,
                    })),
                  },
                ],
                page: { isTruncated: false },
                simulated: true,
              };
            } else if (
              (key === "revit.catalog.loaded-families" || key === "revit.matrix.loaded-families") &&
              seed.route === "families"
            ) {
              const names = (input as { filter?: { familyNames?: string[] } }).filter?.familyNames;
              value = {
                summary: { truncated: false },
                families: seed.readings.families
                  .map((familyName, index) => loadedFamily(index + 1, familyName))
                  .filter((family) => !names?.length || names.includes(family.familyName)),
                simulated: true,
              };
            } else if (key === "families.capture" && seed.route === "families") {
              value = {
                diagnostics: [],
                families: (input as { familyIds: number[] }).familyIds.map((familyId) => {
                  const familyName = seed.readings.families[familyId - 1];
                  return {
                    familyId,
                    familyName,
                    success: familyName !== undefined,
                    modelJson: familyName
                      ? JSON.stringify({
                          family: { name: familyName },
                          types: {},
                          parameters: {},
                          unmodeled: SIMULATED_UNMODELED,
                        })
                      : null,
                    coverage: { simulation: "Supplied demo profile only; no native capture" },
                    unmodeledCount: SIMULATED_UNMODELED.length,
                    issues: [],
                    error: familyName ? null : "Unknown simulated family",
                  };
                }),
                simulated: true,
              };
            } else if (key === "family.build" && seed.route === "family") {
              if (seed.scenario === "native-unknown")
                throw new BridgeError("Simulated lost native result", 503);
              value = {
                familyName: "Demo",
                // The build lands in the run folder; the simulated engine names the same shape.
                outputPath: `output/${new Date().toISOString().replace(/[:.]/g, "-")}/Demo.rfa`,
                converged: true,
                residueCount: 0,
                receiptPath: null,
                simulated: true,
                proof: "No RFA was created",
              };
            } else throw unsupported(key);
            return { value, target: { session: id, document: at } };
          },
          catch: (error) =>
            error instanceof BridgeError
              ? error
              : new BridgeError(String(error), 409, { notDispatched: true }),
        }),
    } as unknown as RevitBridge["Service"];
    // Preparation may materialize a fresh read, never an imported action or receipt.
    if (seed.route === "parameter-links" && seed.readings.prepareEvaluation)
      await readFamily(
        { key: "parameter-links.read", scope, target, input: { evaluate: true } },
        captures,
        bridge,
        { workspace: work },
      );
    const dispatch: CallRouteDispatch = (key, request) =>
      Effect.tryPromise({
        try: async () => {
          if (key === "pod.list") return settings.listPods();
          if (key === "pod.runs")
            return settings.listRuns(request as Parameters<typeof settings.listRuns>[0]);
          if (key === "pod.member.read")
            return settings.readMember(request as Parameters<typeof settings.readMember>[0]);
          if (key === "pod.member.compose")
            return settings.composeMember(request as Parameters<typeof settings.composeMember>[0]);
          if (key === "pod.member.write") throw unsupported("direct write; use settings.write");
          if (key === "bridge.sessions.list")
            return { sessions: sessions.map((s) => ({ ...s, ...s.state })) };
          if (key === "rhvac.list") {
            await assertDemoPath(root, (request as { dir: string }).dir);
            return { exists: true, files: [{ path: join(root, "demo.r10"), name: "demo.r10" }] };
          }
          if (key === "rhvac.open") {
            const requestedPath = await assertDemoPath(root, (request as { path: string }).path);
            if (seed.failure.kind === "read" && !r10Failed) {
              r10Failed = true;
              throw Error(seed.failure.message);
            }
            return rhvac.openFile(requestedPath);
          }
          throw unsupported(key);
        },
        catch: (error) =>
          error instanceof BridgeError
            ? error
            : new BridgeError(String(error), 409, { notDispatched: true }),
      });
    const web = HttpRouter.toWebHandler(
      makeCallRoute(
        journal,
        captures,
        {
          ...settings,
          workspace: work,
          sdk: async (args) => {
            if (!args.includes("session"))
              throw Error("Unsupported simulated SDK receipt recovery");
            return JSON.stringify({
              result: {
                sessions: [
                  {
                    case: "controlled-active",
                    process: {
                      pid: 42,
                      processStartUtc: "1970-01-01T00:00:01.0000000Z",
                      executable: join(root, "SIMULATED.exe"),
                    },
                  },
                ],
              },
              diagnostics: [],
              resolved: null,
              binary: {},
              command: {},
              nextSteps: [],
              guide: "session",
              related: [],
            });
          },
          fileVersion: rhvac.fileVersion,
          openFile: rhvac.openFile,
          syncFile: rhvac.syncFile,
          // ponytail: the publication-refusal scenario races Work after the first member write.
          runPods: async (effect) => {
            const result = await settings.runPods(effect);
            if (
              seed.route === "family" &&
              seed.scenario === "publication-refusal" &&
              isMemberWrite(result)
            ) {
              const current = await work.read(scope, settingsRouteState.route);
              await work.apply(
                scope,
                settingsRouteState.route,
                "human",
                [
                  {
                    path: ["fields", "/family/name", "staged"],
                    value: { value: "Later local edit" },
                  },
                ],
                current!.revision,
              );
            }
            return result;
          },
        },
        { forwardBase: null, dispatch, local: rhvac.local, captureHostOp: () => {} },
      ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
      { disableLogger: true, memoMap: Layer.makeMemoMapUnsafe() },
    );
    const streams = new Set<AbortController>();
    // One-shot readings (a schedule reading, scoped receipts) read this owner's own surface.
    const hostObserve = hostResourceObserver(
      bridge,
      () => journal,
      () => captures,
      "http://demo",
      (url, init) => handle(new Request(url, init)),
    );
    // A work reading key is the flattened WorkKey plus `kind`, so compare the Work key's own
    // fields, never the whole request object.
    const workKeyOf = ({ route, target, work }: WorkKey): WorkKey =>
      work === undefined ? { route, target } : { route, target, work };
    const localScope = (value: WorkKey) =>
      canonicalRouteInput(workKeyOf(value)) === canonicalRouteInput(workKeyOf(scope)) ||
      value.target === at;
    const routes = new Set([route, scheduleGridRouteState.route]);
    const observe: ResourceObserver = (request, publish) => {
      const targetMatches = (ref: typeof target) =>
        ref.session === id && ref.openId === target.openId;
      const allowed =
        request.kind === "inventory" ||
        request.kind === "world" ||
        request.kind === "host-status" ||
        (request.kind === "work" && routes.has(request.route) && localScope(request)) ||
        (request.kind === "schedule-reading" &&
          (request.subject !== "catalog" || targetMatches(request.target!))) ||
        (request.kind === "family-readings" && localScope(request.work)) ||
        (request.kind === "takeoff-reading" && targetMatches(request.target)) ||
        (request.kind === "receipts" &&
          (!request.target || targetMatches(request.target)) &&
          (!request.id || request.id.startsWith(`${id}:`)));
      if (!allowed) {
        publish({
          kind: "failure",
          key: readingKey(request),
          error: "Resource belongs outside this isolated demo owner",
        });
        return () => {};
      }
      if (request.kind === "work")
        return work.observe(request, request.route, (result) =>
          publish(
            "error" in result
              ? { kind: "failure", key: readingKey(request), error: result.error }
              : {
                  kind: "snapshot",
                  key: readingKey(request),
                  value: result.value,
                },
          ),
        );
      return hostObserve(request, publish);
    };
    const description = {
      id,
      base: `/demo/instances/${id}`,
      root,
      r10Path: join(root, "demo.r10"),
      target,
      at,
      scope,
      route,
      member: files[0]?.member,
      simulated: true,
    };
    releaseHandler = () => web.dispose();
    async function handle(request: Request): Promise<Response> {
      if (retired) return json({ error: "Demo instance retired" }, 410);
      const url = new URL(request.url);
      if (url.pathname === "/pe/resources") {
        const controller = new AbortController();
        streams.add(controller);
        request.signal.addEventListener(
          "abort",
          () => {
            controller.abort();
            streams.delete(controller);
          },
          { once: true },
        );
        return resourceResponse(new Request(request, { signal: controller.signal }), observe);
      }
      if (url.pathname === "/description") return json(description);
      // The lamp's read: this owner is the host, and its simulated session is the attached Revit.
      if (url.pathname === "/host/status")
        return json({
          controllerId: id,
          capabilities: { revit: true },
          bridgeIsConnected: true,
          simulated: true,
        });
      if (url.pathname === "/work" && request.method === "GET")
        return json(await work.read(scope, route));
      if (url.pathname === "/work" && request.method === "PATCH") {
        const { patches, revision } = (await request.json()) as {
          patches: Parameters<RouteWorkspace["apply"]>[3];
          revision: number;
        };
        return json(await work.apply(scope, route, "human", patches, revision));
      }
      if (url.pathname === "/work/command" && request.method === "POST") {
        const body = (await request.json()) as {
          name: string;
          input: unknown;
          revision: number;
        };
        return json(
          await work.command(scope, route, "human", body.name, body.input, body.revision),
        );
      }
      if (url.pathname === "/snapshot" && snapshot) {
        const capture = await captures.refresh(
          target,
          async () => ({ result: null, snapshot: localSnapshot(snapshot!) }),
          async () => !retired,
        );
        return json(capture.capture);
      }
      if (url.pathname === "/candidates" && seed.route === "takeoffs")
        return json(seed.readings.candidates);
      if (url.pathname === "/export") {
        const current = await work.read(scope, route);
        if (!current) return json({ kind: "incomplete", missing: ["Work owner"] });
        const exportedFiles = [];
        const missing: string[] = [];
        for (const file of originalFiles) {
          try {
            const reading = await settings.readMember(local(file.member));
            exportedFiles.push({ member: file.member, rawContent: reading.content });
          } catch {
            missing.push(`member ${file.member.pod}/${file.member.path}`);
          }
        }
        if (missing.length) return json({ kind: "incomplete", missing });
        return json({
          kind: "complete",
          seed: exportSeed(
            demoSeedSchema.parse({
              ...seed,
              ...(seed.route === "family"
                ? {
                    readings: {
                      ...seed.readings,
                      files: exportedFiles,
                      captures: await captures.familyReadings(scope),
                    },
                  }
                : {
                    files: exportedFiles,
                    readings: {
                      ...seed.readings,
                      snapshot: localSnapshot(snapshot!),
                      rhvac: rhvac.seed(),
                    },
                  }),
              originalEvidence: {
                imported: seed.originalEvidence,
                originalWork: seed.work,
                originalReadings: seed.readings,
                originalFiles,
                receipts: await journal.list(),
              },
              work: { scope, revision: current.revision, candidate: current.doc },
            }),
          ),
        });
      }
      if (url.pathname === "/actions" && request.method === "POST") {
        const body = (await request.clone().json()) as {
          id?: string;
          destination?: { kind: string; ref?: typeof target };
        };
        if (
          !body.id?.startsWith(`${id}:`) ||
          (body.destination?.kind === "document" &&
            (body.destination.ref?.session !== id ||
              body.destination.ref?.openId !== target.openId))
        )
          return json(
            { error: "Only new local demo requests and destinations are executable" },
            409,
          );
      }
      if (url.pathname === "/family/readings" && request.method === "POST") {
        const body = (await request.clone().json()) as { key: string };
        if (body.key !== "family.saved")
          return json({ error: "Unsupported or nonlocal Family reading" }, 409);
      }
      // The browser's Work writes (`/pe/route-state/<route>/<apply|command>`), fenced to this owner.
      const write = /^\/pe\/route-state\/([^/]+)\/(apply|command)$/.exec(url.pathname);
      if (write && request.method === "POST") {
        const [, written, operation] = write as unknown as [string, string, "apply" | "command"];
        const target = url.searchParams.get("target");
        const workId = url.searchParams.get("work");
        const key: WorkKey = {
          route: written,
          target: target ? address(target) : null,
          ...(workId ? { work: workId } : {}),
        };
        if (!routes.has(written) || !localScope(key))
          return json({ ok: false, kind: "error", error: "Work belongs outside this demo" }, 403);
        const body = (await request.json()) as {
          patches: Parameters<RouteWorkspace["apply"]>[3];
          command: string;
          input?: unknown;
          expectedRevision: number;
        };
        return json(
          operation === "apply"
            ? await work.apply(key, written, "human", body.patches, body.expectedRevision)
            : await work.command(
                key,
                written,
                "human",
                body.command,
                body.input,
                body.expectedRevision,
              ),
        );
      }
      const response = await web.handler(request, Context.empty() as never);
      if (response.status === 404)
        return json({ error: `Unmapped isolated request ${request.method} ${request.url}` }, 404);
      return response;
    }
    return {
      ...description,
      work,
      journal,
      captures,
      settings,
      fetch(request: Request) {
        const task = handle(request);
        pending.add(task);
        void task.finally(() => pending.delete(task)).catch(() => {});
        return task;
      },
      dispose() {
        return (disposal ??= (async () => {
          retired = true;
          for (const controller of streams) controller.abort();
          streams.clear();
          await Promise.allSettled(pending);
          for (const row of await journal.list())
            if (row.state === "running") await journal.wait(row.id);
          await web.dispose();
          await assertDemoPath(parent, root);
          await rm(root, { recursive: true, force: true });
        })());
      },
    };
  } catch (error) {
    await releaseHandler?.();
    await assertDemoPath(parent, root);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

const isMemberWrite = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  "pod" in value &&
  "sha256" in value &&
  !("content" in value);

/** Explicit routes are more specific than the production /pe/* tenant; no second listener. */
export function demoRoutes(parent = resolve(".artifacts/tmp/demos")) {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const owners = new Map<string, Awaited<ReturnType<typeof createDemoOwner>>>();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await Promise.all([...owners.values()].map((owner) => owner.dispose()));
        }),
      );
      const handler = HttpEffect.fromWebHandler(async (request) => {
        try {
          const url = new URL(request.url);
          if (url.pathname === "/demo/instances" && request.method === "POST") {
            const body = (await request.json()) as { seed?: unknown };
            if (typeof body.seed !== "string") throw Error("Encoded DemoSeed is required");
            const owner = await createDemoOwner(parent, importSeed(body.seed));
            owners.set(owner.id, owner);
            return owner.fetch(new Request(new URL("/description", url)));
          }
          const match = /^\/demo\/instances\/([^/]+)(\/.*)?$/.exec(url.pathname);
          const owner = match ? owners.get(match[1]!) : undefined;
          if (!owner && request.method === "DELETE" && match && !match[2])
            return json({ retired: match[1] });
          if (!owner) return json({ error: "Unknown isolated demo instance" }, 404);
          if (request.method === "DELETE" && !match![2]) {
            await owner.dispose();
            owners.delete(owner.id);
            return json({ retired: owner.id });
          }
          url.pathname = match![2] ?? "/description";
          return await owner.fetch(
            new Request(url, {
              method: request.method,
              headers: request.headers,
              signal: request.signal,
              ...(request.method === "GET" || request.method === "HEAD"
                ? {}
                : { body: await request.arrayBuffer() }),
            }),
          );
        } catch (error) {
          return json({ error: String(error) }, 409);
        }
      });
      yield* router.add("*", "/demo/instances/*", handler);
    }),
  );
}
