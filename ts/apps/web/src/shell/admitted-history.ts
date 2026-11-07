import { cancelAction } from "../../../../packages/mcps/src/shared/takeoff-action-client.ts";
import type { createWorkJournal } from "../../../../packages/runtime/src/work-journal.ts";
import type { MountContext } from "./admitted-context.ts";
import { freezePage } from "./page-port.ts";
export function createAdmittedHistory<W extends Record<string, unknown>>(context: MountContext<W>) {
  const {
    route,
    owner,
    read,
    action,
    resolve,
    notify,
    closed,
    mountJournal,
  } = context;
  const work = context.work();

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
  const journalRefusal = () =>
    !work.ready()
      ? "Work unavailable"
      : journalProblem?.journal === journal() &&
          journalProblem?.revision === journal()?.read().revision
        ? (journalProblem?.message ?? null)
        : null;
  const { entryFor, sourceTimeline, now } = context;
  return {
    logEvidence: (readingId: string, value: unknown) => {
      const key = read().scope.identity.work;
      if (!key) return;
      const entry = entryFor(key);
      const rows = sourceTimeline.get(entry) ?? [];
      rows.push(
        freezePage({
          kind: "feed",
          at: now(),
          subject: readingId,
          basis: value,
        }),
      );
      if (rows.length > 200) rows.shift();
      sourceTimeline.set(entry, rows);
    },
    public: {
      history,
      stopCommand(id: string) {
        action();
        const key = owner.read()?.scope.identity.work;
        const receipt = key
          ? entryFor(key)
              .activity()
              .find((row) => row.id === id)
          : undefined;
        if (!receipt || !["waiting", "running", "unknown"].includes(receipt.state))
          throw Error("Command is not pending in this Work");
        return cancelAction(id);
      },
      timeline: () => {
        const key = owner.read()?.scope.identity.work;
        const entry = key ? entryFor(key) : null;
        return freezePage(
          [...(entry?.timeline() ?? []), ...(sourceTimeline.get(entry ?? owner) ?? [])].sort(
            (a, b) => Number(new Date(a.at)) - Number(new Date(b.at)),
          ),
        );
      },
      activity: () => {
        const key = owner.read()?.scope.identity.work;
        return key ? entryFor(key).activity() : [];
      },
      journal: () => journal()?.read() ?? null,
      journalRefusal: journalRefusal,
      restoreWork: restore,
    },
  };
}
