/**
 * The model writes of both routes behind one carrier pattern: read the record replacements at the
 * plan, seal them, and pass them to the native leaf at apply. Moved from the host app's takeoff
 * actions; the Rooms commands are in `rooms.ts`.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { win32 } from "node:path";
import { Effect } from "effect";
import {
  nativeProcessSchema,
  stagedDecisions,
  stagedRoomEditSchema,
  stagedTakeoffEdits,
  takeoffCaptureSchema,
  takeoffDecisionAddress,
  takeoffDecisionKey,
  takeoffEditAddress,
  takeoffEditKey,
  workAdmissionSchema,
  type Consumed,
  type NativeProcess,
  type StagedRoomEdit,
} from "@pe/agent-contracts";
import { nativeRequestSchema, nativeResponseSchema } from "@pe/host-contracts/decoders";
import type { HostOperationKey, RhvacSyncRequest } from "@pe/host-contracts/operation-types";
import type { ActionExecution, Step } from "@pe/host-internal/action-execution";
import type { RevitBridge } from "@pe/host-internal/bridge";
import {
  command,
  nativeStep,
  refused,
  type CommandContext,
} from "@pe/host-internal/command-executor";
import type { CommandBody } from "@pe/host-internal/product";
import { product, takeoffsWork } from "@pe/rooms-contract/product";

const { commands } = product;
export type Deps = Parameters<CommandBody>[1];
/** Admission context is no native field. */
export const nativeRequestInput = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(input).filter(([key]) => !Object.hasOwn(workAdmissionSchema.shape, key)),
  );

const recordReplacements = nativeResponseSchema("takeoffs.record-replacements");
export const preparedCarrierSchema = z.strictObject({
  process: nativeProcessSchema,
  replacement: recordReplacements.optional(),
});
const preparedSyncSchema = preparedCarrierSchema.extend({
  edits: z.record(z.string(), stagedRoomEditSchema),
  decisions: z.record(z.string(), z.enum(["accept", "dismiss"])),
  capture: takeoffCaptureSchema,
  replacement: recordReplacements,
});
export const sealCarrier = ({ process, replacement }: z.infer<typeof preparedCarrierSchema>) => ({
  request: { process, replacement },
  evidence: replacement,
});
export const replacing = (p: z.infer<typeof preparedCarrierSchema>) => p.replacement?.regions ?? undefined;
const modelTarget = (ctx: CommandContext) => {
  if (ctx.admission.target.kind !== "document") throw refused("Exact document target required");
  return ctx.admission.target.ref;
};
/** The Work boundary already bound the Work to this document; this binds the project's lifetime. */
async function bindModel(ctx: CommandContext, deps: Deps) {
  const target = modelTarget(ctx);
  if (!deps.projectLifetime) throw refused("No project lifetime is bound on this host");
  return { target, process: await deps.projectLifetime(target) };
}

const nativeFor =
  (
    ctx: CommandContext,
    execution: ActionExecution,
    bridge: RevitBridge["Service"],
    process: NativeProcess,
  ) =>
  <A = unknown>(key: string, input: unknown) =>
    execution.step(
      "native",
      key,
      input,
      (id) => nativeStep<A>(bridge, modelTarget(ctx), key, input, id),
      { process },
    );
type Native = ReturnType<typeof nativeFor>;

/** Only Takeoffs registry initialization needs a separate binding step. */
export const runModel = (
  ctx: CommandContext,
  execution: ActionExecution & { readonly prepared: { process: NativeProcess } },
  deps: Deps,
  bridge: RevitBridge["Service"],
  stage: string | null,
  perform: (native: Native) => Step<unknown>,
) => {
  const target = modelTarget(ctx);
  const native = nativeFor(ctx, execution, bridge, execution.prepared.process);
  return Effect.gen(function* () {
    deps.captures?.invalidate(target);
    let remaining = stage === null ? 0 : Infinity;
    while (remaining > 0) {
      const result = yield* native<{ remaining: string[] }>("takeoffs.initialize-carrier", {
        stage,
      });
      if (!Array.isArray(result.remaining) || result.remaining.length >= remaining)
        throw Error("Carrier preparation made no progress");
      remaining = result.remaining.length;
    }
    return yield* perform(native);
  }).pipe(Effect.ensuring(Effect.sync(() => deps.captures?.invalidate(target))));
};

/** What the plan saw of the records an apply may replace; the apply sends exactly that. */
export const carrier = (bridge: RevitBridge["Service"], deps: Deps) => {
  const replacementFor = async (ctx: CommandContext, registry = false) => {
    // The platform sheet pair plans under its own key, not a `.preview` twin.
    if (!ctx.admission.key.endsWith(".preview") && ctx.admission.key !== "sheet.plan") {
      const plan = ctx.read.receipts(ctx.admission.id)[0];
      return plan?.state === "succeeded"
        ? recordReplacements.parse((plan.result as { evidence: unknown }).evidence)
        : { regions: null, registry: null };
    }
    const { regions, registry: systems } = recordReplacements.parse(
      await Effect.runPromise(
        nativeStep(bridge, modelTarget(ctx), "takeoffs.record-replacements", {}),
      ),
    );
    return { regions: regions ?? null, registry: registry ? (systems ?? null) : null };
  };
  /** `requests` are the native leaf's inputs: validated before the first model write. */
  const bind = async (
    ctx: CommandContext,
    leaf: HostOperationKey,
    requests: readonly unknown[],
    replaces: false | "regions" | "registry" = "regions",
  ) => {
    for (const request of requests) {
      const checked = nativeRequestSchema(leaf).safeParse(request);
      if (!checked.success)
        throw refused(
          `Invalid native input for '${leaf}': ${checked.error.message}`,
          "native.input",
        );
    }
    const { target, process } = await bindModel(ctx, deps);
    const replacement = replaces ? await replacementFor(ctx, replaces === "registry") : undefined;
    return {
      consumes: [
        {
          kind: "incarnation" as const,
          probe: { target: ctx.admission.target, process },
          expected: true as const,
        },
      ],
      effects: [{ kind: "document" as const, ref: target }],
      prepare: async () => ({ process, replacement }),
    };
  };
  return { replacementFor, bind };
};

export function takeoffExecutors(bridge: RevitBridge["Service"], deps: Deps) {
  const { replacementFor, bind } = carrier(bridge, deps);
  const input = (ctx: CommandContext) => nativeRequestInput(ctx.admission.input);
  const value = (ctx: CommandContext, native: Native, key: string, input: unknown) =>
    Effect.map(native(key, input), (value) => ({
      value,
      target: { session: modelTarget(ctx).session, document: null },
    }));
  return {
    "takeoffs.initialize": command(commands["takeoffs.initialize"], preparedCarrierSchema, {
      seal: sealCarrier,
      bind: (ctx) => bind(ctx, "takeoffs.initialize-carrier", [input(ctx)], false),
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, ctx.admission.input.stage, () =>
          Effect.succeed({ text: `wrote the shared parameters for ${ctx.admission.input.stage}` }),
        ),
    }),
    "takeoffs.adopt": command(commands["takeoffs.adopt"], preparedCarrierSchema, {
      seal: sealCarrier,
      bind: (ctx) => bind(ctx, "takeoffs.adopt", ctx.admission.input.views, "registry"),
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, "Adoption", (native) =>
          Effect.gen(function* () {
            let adopted = 0;
            for (const [index, view] of ctx.admission.input.views.entries())
              adopted += (yield* native<{ adopted: unknown[] }>("takeoffs.adopt", {
                ...view,
                replacing: index === 0 ? replacing(execution.prepared) : undefined,
                replacingRegistry:
                  index === 0 ? (execution.prepared.replacement?.registry ?? undefined) : undefined,
              })).adopted.length;
            return { adopted, text: `adopted ${adopted} zoning regions` };
          }),
        ),
    }),
    "takeoffs.partition": command(commands["takeoffs.partition"], preparedCarrierSchema, {
      seal: sealCarrier,
      bind: (ctx) =>
        bind(ctx, "takeoffs.partition", [{ ...input(ctx), runId: ctx.admission.id }]),
      run: (ctx, execution) =>
        runModel(ctx, execution, deps, bridge, null, (native) => {
          return value(ctx, native, "takeoffs.partition", {
            ...nativeRequestInput(ctx.admission.input),
            runId: ctx.admission.id,
            replacing: replacing(execution.prepared),
          });
        }),
    }),
    "takeoffs.sync": command(commands["takeoffs.sync"], preparedSyncSchema, {
      seal: (p) => ({
        request: {
          process: p.process,
          edits: p.edits,
          decisions: p.decisions,
          capture: p.capture.id,
          replacement: p.replacement,
        },
        evidence: p.replacement,
      }),
      bind: async (ctx) => {
        const { target, process } = await bindModel(ctx, deps);
        const { input } = ctx.admission;
        const { captures, rhvac } = deps;
        if (!captures || !rhvac) throw refused("This host has no RHVAC file lane");
        const capture = await captures.saved(input.captureId);
        if (
          capture.provenance.kind !== "live" ||
          capture.provenance.target.session !== target.session ||
          capture.provenance.target.openId !== target.openId
        )
          throw refused("Capture is not evidence for the admitted lifetime");
        const artifact = await captures.savedText(capture.id);
        const consumes: Consumed[] = [
          { kind: "incarnation", probe: { target: ctx.admission.target, process }, expected: true },
          {
            kind: "file",
            probe: { path: artifact.path },
            expected: createHash("sha256").update(artifact.text).digest("hex"),
          },
          { kind: "file", probe: { path: input.path }, expected: input.fileVersion },
        ];
        let edits: Record<string, StagedRoomEdit> = {},
          decisions: Record<string, "accept" | "dismiss"> = {};
        const base = input.work;
        if (base) {
          const rooms = new Set(
            capture.snapshot.world.zones
              .filter((zone) => !input.zones.length || input.zones.includes(zone.zone.guid))
              .flatMap((zone) => zone.rooms.map((room) => room.guid)),
          );
          const doc = await ctx.selectWork(takeoffsWork, base, (_doc, cells) => {
            const selected = cells.filter(({ path }) =>
              path[0] === "edits"
                ? rooms.has(takeoffEditAddress(String(path[1])).roomId)
                : path[0] === "decisions" &&
                  rooms.has(takeoffDecisionAddress(String(path[1])).roomGuid),
            );
            return { cells: selected.map(({ path }) => path), facts: [] };
          });
          edits = Object.fromEntries(
            Object.entries(stagedTakeoffEdits(doc)).filter(([room]) => rooms.has(room)),
          );
          decisions = Object.fromEntries(
            Object.entries(stagedDecisions(doc)).filter(([key]) =>
              rooms.has(takeoffDecisionAddress(key).roomGuid),
            ),
          );
        }
        const replacement = await replacementFor(ctx);
        return {
          consumes,
          effects: [
            { kind: "document", ref: target },
            { kind: "file", path: input.path },
          ],
          prepare: async () => ({
            process,
            edits,
            decisions,
            capture,
            replacement,
          }),
        };
      },
      run: (ctx, execution) => {
        const { input } = ctx.admission;
        const target = modelTarget(ctx);
        const base = input.work;
        const { process, edits: stagedEdits, decisions, capture } = execution.prepared;
        const submitted = { edits: stagedEdits, decisions };
        const native = nativeFor(ctx, execution, bridge, process);
        const rhvac = deps.rhvac!;
        return Effect.gen(function* () {
          deps.captures?.invalidate(target);
          const selected = new Set(input.zones);
          const zones = capture!.snapshot.world.zones.filter(
            (zone) => !selected.size || selected.has(zone.zone.guid),
          );
          const edits = new Map(Object.entries(submitted?.edits ?? {}));
          const blocked = zones.filter(
            (zone) =>
              zone.driftSqft === null ||
              zone.driftSqft > 0 ||
              zone.rooms.some(
                (room) =>
                  room.analysis?.state !== "current" ||
                  room.analysis.hold !== null ||
                  room.flags.some(
                    (flag) =>
                      submitted?.decisions[takeoffDecisionKey(room.guid, flag)] === undefined,
                  ),
              ) ||
              zone.runs.some((run) => run.orphaned > 0 || run.failures > 0),
          );
          if (blocked.length)
            throw refused(`${blocked.length} selected zones are not ready to sync`);
          const inserts = zones.flatMap((zone) =>
            zone.rooms
              .filter((room) => room.elementId !== null && !room.r10 && room.data !== null)
              .map((room) => ({ zone, room })),
          );
          const linked = zones
            .flatMap((zone) => zone.rooms)
            .filter((room) => room.r10 && edits.has(room.guid));
          if (!inserts.length && !linked.length)
            throw refused("No eligible inserts or linked staged updates");
          if (inserts.some(({ zone }) => !zone.tags[0]))
            throw refused("Every inserted room requires a system tag");
          const replacement = replacing(execution.prepared);
          if (inserts.length && replacement)
            throw refused(
              `${replacement.reason}. Preview and apply rooms.draw, rooms.partition, or takeoffs.adopt to recover it.`,
            );
          const recordedFile = execution.recorded("file", "rhvac.sync");
          const request: RhvacSyncRequest = recordedFile
            ? (recordedFile.input as { request: RhvacSyncRequest }).request
            : yield* Effect.gen(function* () {
                const before = yield* rhvac.open(input.path);
                const firstRoomNumber = Math.max(0, ...before.rooms.map((room) => room.number)) + 1;
                const bySystemName = new Map(
                  before.systems
                    .filter((system) => system.name.trim())
                    .map((system) => [system.name.trim().toLocaleLowerCase(), system.number]),
                );
                const [only, ...others] = before.rooms;
                const firstRun =
                  only !== undefined &&
                  !others.length &&
                  only.number === 1 &&
                  !only.name.trim() &&
                  only.areaSquareFeet === 0;
                let nextSystem = Math.max(0, ...before.systems.map((system) => system.number)) + 1;
                const systems = new Map<string, number>();
                for (const { zone } of inserts) {
                  const tag = zone.tags[0]!;
                  if (systems.has(tag)) continue;
                  const existing = bySystemName.get(tag.trim().toLocaleLowerCase());
                  if (existing !== undefined) systems.set(tag, existing);
                  else if (firstRun) systems.set(tag, nextSystem++);
                  else throw refused(`system '${tag}' does not exist in this non-first-run .r10`);
                }
                const fileRooms = new Map(before.rooms.map((room) => [room.identifier, room]));
                const updates = linked.map((room) => {
                  const current = fileRooms.get(room.r10!.identifier);
                  if (!current)
                    throw refused(`Linked .r10 room ${room.r10!.identifier} no longer exists`);
                  return rhvac.applyStaged(current, edits.get(room.guid)!);
                });
                return {
                  targetPath: input.path,
                  updates,
                  inserts: inserts.map(({ zone, room }, index) =>
                    edits.has(room.guid)
                      ? rhvac.applyStaged(
                          rhvac.buildInsert(
                            room,
                            firstRoomNumber + index,
                            systems.get(zone.tags[0]!)!,
                          ),
                          edits.get(room.guid)!,
                        )
                      : rhvac.buildInsert(
                          room,
                          firstRoomNumber + index,
                          systems.get(zone.tags[0]!)!,
                        ),
                  ),
                  systems: [
                    ...before.systems.map((system) => ({
                      number: system.number,
                      name: system.name,
                    })),
                    ...[...systems]
                      .filter(
                        ([, number]) => !before.systems.some((system) => system.number === number),
                      )
                      .map(([name, number]) => ({ name, number })),
                  ],
                  deleteUntouchedSeedRoom: inserts.length > 0,
                } satisfies RhvacSyncRequest;
              });
          const syncedAt = new Date().toISOString();
          if (inserts.length && !recordedFile) {
            // Jet assigns a signed int and the file identity is the input basename plus a 16-digit hex stamp.
            yield* nativeStep(bridge, target, "takeoffs.rhvac-links.preflight", {
              writes: inserts.map(({ room }) => ({
                elementId: room.elementId!,
                uniqueId: room.guid,
                link: {
                  identifier: -2147483648,
                  fileIdentity: `${win32.basename(input.path)}#${"0".repeat(16)}`,
                  syncedAt,
                  lastSyncedSqft: room.sqft,
                },
              })),
            }).pipe(Effect.mapError((error) => refused(error.message)));
          }
          const expectedVersion = input.fileVersion as string;
          const result = yield* execution.step(
            "file",
            "rhvac.sync",
            { request, expectedVersion },
            () => rhvac.sync(request, expectedVersion),
          );
          const byNumber = new Map(
            result.insertedRooms.map((room) => [room.number, room.identifier]),
          );
          const fileIdentity = `${result.fileIdentity.fileName}#${result.fileIdentity.stamp}`;
          const writes = inserts.map(({ room }, index) => {
            const identifier = byNumber.get(request.inserts![index]!.number);
            if (identifier === undefined)
              throw Error("RHVAC insertion result omitted a room identity");
            return {
              elementId: room.elementId!,
              uniqueId: room.guid,
              link: {
                identifier,
                fileIdentity,
                syncedAt,
                lastSyncedSqft: room.sqft,
              },
            };
          });
          if (writes.length) {
            const recordedLinks = execution.recorded("native", "takeoffs.rhvac-links");
            yield* native(
              "takeoffs.rhvac-links",
              recordedLinks?.input ?? { writes, replacing: replacement },
            );
          }
          let retirement: unknown;
          if (base) {
            const consumed = new Map(
              [...linked, ...inserts.map(({ room }) => room)]
                .filter((room) => edits.has(room.guid))
                .map((room) => [room.guid, edits.get(room.guid)!]),
            );
            retirement = yield* execution.retireWork(
              base.key,
              "takeoffs",
              [...consumed].flatMap(([roomId, edit]) =>
                Object.keys(edit.next).map((field) => [
                  "edits",
                  takeoffEditKey(roomId, field as keyof typeof edit.next),
                ]),
              ),
            );
          }
          return {
            inserted: result.insertedRooms.length,
            updated: result.updated,
            text: `synced ${result.insertedRooms.length} inserted and ${result.updated} updated rooms into ${input.path}`,
            file: result,
            retirement,
          };
        }).pipe(Effect.ensuring(Effect.sync(() => deps.captures?.invalidate(target))));
      },
    }),
  };
}
