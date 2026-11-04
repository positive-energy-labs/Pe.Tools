import { OLDER_WORK, UNREADABLE_WORK } from "@pe/agent-contracts";
import { z } from "zod";
import type { createWorkJournal } from "../../../../packages/runtime/src/work-journal.ts";
import { peReadings } from "../readings.ts";
import { admittedWorkPatches } from "./admitted-cells.ts";
import type { MountContext } from "./admitted-context.ts";
import { currentReadingHashes, projectEvidence } from "./admitted-context.ts";
import { freezePage } from "./page-port.ts";
/** The notice is provenance for the existing recovery banner, not another recovery state. */
export type RecoveryState = (
  | { kind: "idle" }
  | { kind: "saved"; from: string; value: unknown }
  | { kind: "busy" }
  | { kind: "problem"; sentence: string }
) & { notice?: string | null };
export function createAdmittedHistory<W extends Record<string, unknown>>(context: MountContext<W>) {
  const {
    route,
    owner,
    read,
    bindings,
    recoveryHost,
    action,
    resolve,
    notify,
    closed,
    mountJournal,
  } = context;
  const work = context.work(),
    invocation = context.invocation(),
    snapshots = context.readings().snapshots;

  let state: RecoveryState = { kind: "idle" };
  const { present, reviews } = invocation;
  let recoveryScope: unknown;
  let recoveryRevision: number | null = null;
  function syncRecovery() {
    const snapshot = owner.read();
    if (snapshot?.scope !== recoveryScope) {
      recoveryScope = snapshot?.scope;
      recoveryRevision = null;
      state = { kind: "idle" };
    }
    if (
      !recoveryHost ||
      !route.data.salvage ||
      !work.ready() ||
      !snapshot?.work ||
      snapshot.work.revision === recoveryRevision
    )
      return;
    recoveryRevision = snapshot.work.revision;
    const scope = snapshot.scope;
    const revision = recoveryRevision;
    void recoveryHost.salvageRouteWork(scope.identity.work!).then(
      (saved) => {
        if (closed() || owner.read()?.scope !== scope || recoveryRevision !== revision) return;
        if (state.kind !== "busy")
          state = saved
            ? { kind: "saved", ...saved, notice: state.notice }
            : { kind: "idle", notice: state.notice };
        notify();
      },
      (error: unknown) => {
        if (closed() || owner.read()?.scope !== scope || recoveryRevision !== revision) return;
        state = { kind: "problem", sentence: String(error), notice: state.notice };
        notify();
      },
    );
  }
  const journal = () => {
    const key = owner.read()?.scope.identity.work;
    return key ? mountJournal(key) : null;
  };
  let journalProblem: {
    message: string;
    journal: ReturnType<typeof createWorkJournal>;
    revision: number | null;
  } | null = null;
  const historyProblem = (
    current: ReturnType<typeof createWorkJournal>,
    message: string | null,
  ) => {
    journalProblem = message
      ? { message, journal: current, revision: current.read().revision }
      : null;
  };
  const restore = async (direction: "undo" | "redo", press?: string) => {
    action();
    resolve();
    const current = journal();
    if (closed() || !work.ready() || !current) throw Error("Work unavailable");
    const basis = owner.invocation(owner.capture(`history:${direction}`), {});
    if (!basis.ok) throw Error(basis.reason);
    const result = await current[direction]((request) => work.submit(request, basis.value), press);
    historyProblem(current, result.ok ? null : result.message);
    notify();
    return result;
  };
  const revert = async (press?: string) => {
    resolve();
    const current = journal();
    if (closed() || !work.ready() || !current) throw Error("Work unavailable");
    const state = current.read();
    const step = state.undo.at(-1);
    if (!step || (press !== undefined && step.press !== press))
      throw Error("The selected history entry is no longer last");
    if (state.busy || step.barrier || step.superseded)
      throw Error(step.superseded?.message ?? "History step is blocked");
    const basis = owner.invocation(owner.capture("history:revert"), {});
    if (!basis.ok) throw Error(basis.reason);
    // An ordinary appended edit of the host's inverse makes Revert itself undoable.
    const result = await work.submit(
      {
        kind: "apply",
        expectedRevision: read().work!.revision,
        press: basis.value.id,
        label: `Revert ${step.label}`,
        patches: step.transitions
          .slice(0, step.cursor)
          .reverse()
          .flatMap((t) => t.inverse),
      },
      basis.value,
    );
    if (result.ok) current.describe(basis.value.id, { label: `Revert ${step.label}` });
    historyProblem(
      current,
      result.ok ? null : "agentHint" in result ? result.agentHint : result.error,
    );
    notify();
    return result;
  };
  const history = route.data.work
    ? {
        get entries() {
          return freezePage(journal()?.entries() ?? []);
        },
        undo: (press?: string) => restore("undo", press),
        redo: (press?: string) => restore("redo", press),
        revert,
      }
    : undefined;
  const prepareSalvage = async () => {
    action();
    resolve();
    const key = owner.read()?.scope.identity.work;
    if (!route.data.salvage || !key || !work.ready() || !recoveryHost)
      throw Error("Salvage unavailable");
    const issued = owner.invocation(
      owner.capture("work-salvage"),
      currentReadingHashes(snapshots()),
    );
    if (!issued.ok) throw Error(issued.reason);
    const deps = route.data.salvageDeps ?? { page: [], work: [], readings: [] };
    for (const id of deps.readings)
      if (!snapshots()[id]?.current) throw Error(`Reading unavailable: ${id}`);
    // Display evidence only: the invocation owns freshness, never a second write seal.
    const evidence = projectEvidence(deps, read().page, read().work!.value, snapshots());
    const saved = await recoveryHost.salvageRouteWork(key);
    if (!owner.current(issued.value) || !work.ready()) throw Error("Salvage is stale");
    if (!saved) return null;
    const decoded = z
      .discriminatedUnion("ok", [
        z.strictObject({ ok: z.literal(true), value: z.unknown() }),
        z.strictObject({ ok: z.literal(false), reason: z.string() }),
      ])
      .parse(
        bindings.bodies[route.data.salvage]!.run(
          freezePage(saved.value),
          freezePage({ page: read().page, work: read().work!.value, readings: snapshots() }),
        ),
      );
    if (!decoded.ok) throw Error(decoded.reason);
    const patches = admittedWorkPatches(
      route.data,
      bindings.schemas,
      decoded.value,
      route.resolvedWork?.schema,
    );
    const presentation = present("work.salvage", patches, evidence, route.data.salvagePresent);
    reviews.set("work.salvage", {
      presentation,
      invocation: issued.value,
      preview: patches,
      send: () => {
        if (!owner.current(issued.value) || !work.ready()) throw Error("Salvage is stale");
        return work.write(
          () => patches,
          issued.value,
          issued.value.id,
          { label: "Salvage Work" },
          issued.value,
        );
      },
    });
    state = { kind: "saved", ...saved, notice: state.notice };
    notify();
    return { kind: "review", preview: patches };
  };
  const salvage = async () => {
    const scope = owner.read()?.scope;
    if (state.kind === "problem") state = { kind: "idle", notice: state.notice };
    try {
      return await prepareSalvage();
    } catch (error) {
      if (owner.read()?.scope === scope)
        state = { kind: "problem", sentence: String(error), notice: state.notice };
      throw error;
    } finally {
      notify();
    }
  };
  const recovery = () => ({
    sentence:
      work.problem() === OLDER_WORK || work.problem() === UNREADABLE_WORK
        ? work.problem()
        : work.failure()
          ? null
          : (state.notice ?? null),
    startFresh:
      !!recoveryHost && (work.problem() === OLDER_WORK || work.problem() === UNREADABLE_WORK),
    carryOver: !!recoveryHost && work.ready() && state.kind === "saved",
    busy: state.kind === "busy",
    problem: state.kind === "problem" ? state.sentence : null,
  });
  const startFresh = async () => {
    action();
    resolve();
    if (!recoveryHost || !recovery().startFresh || state.kind === "busy")
      throw Error("Start fresh unavailable");
    const captured = owner.capture("work-recovery");
    const scope = read().scope;
    const key = scope.identity.work!;
    state = { kind: "busy", notice: work.problem() };
    notify();
    try {
      const result = await recoveryHost.startFreshRouteWork(key);
      if (!owner.current(captured)) throw Error("Recovery is stale");
      if (!result.ok) throw Error("agentHint" in result ? result.agentHint : result.error);
      // The terminal failed subscription cannot observe reset. Reacquire with the
      // original admission, including its fingerprint, rather than accepting reset's ack.
      peReadings.dirty({
        ...key,
        kind: "work",
        admission: {
          routeKey: route.resolvedWork!.spec.route,
          fingerprint: route.workFingerprint,
        },
      });
      await work.reopen();
      if (!owner.current(captured)) throw Error("Recovery is stale");
      if (route.data.salvage) return await salvage();
      return null;
    } catch (error) {
      if (owner.read()?.scope === scope)
        state = { kind: "problem", sentence: String(error), notice: state.notice };
      throw error;
    } finally {
      if (owner.read()?.scope === scope && state.kind === "busy")
        state = { kind: "idle", notice: state.notice };
      notify();
    }
  };

  return {
    sync: syncRecovery,
    history,
    salvage,
    recovery,
    startFresh,
    restore,
    journal,
    journalRefusal: () =>
      !work.ready()
        ? "Work unavailable"
        : journalProblem?.journal === journal() &&
            journalProblem?.revision === journal()?.read().revision
          ? (journalProblem?.message ?? null)
          : null,
  };
}
