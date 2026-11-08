import {
  canonicalRouteInput,
  commands,
  workKey,
  type RouteGraph,
  type WorkKey,
  type VerbDecl,
} from "@pe/agent-contracts";

import { causeRefusal, refuse, writeRefusal } from "../route/refusal";
import { type ReadingAttempt } from "./source-contract";

import {
  CONFLICT_REFUSAL,
  type MountAdapters,
  type MountBinding,
  type BindingScope,
} from "./mount-contracts";
import type { MountPage } from "./mount-page-owner";
import type { MountReadings } from "./mount-readings-owner";
import type { MountTarget } from "./mount-target-owner";
import type { MountTimeline } from "./mount-timeline-owner";
import type { MountWork } from "./mount-work-owner";
import {
  bind,
  commit,
  invoke,
  type VerbCompletion,
  type VerbDelivery,
  completeVerb,
  type ReviewTicket,
  type VerbContext,
  type VerbSubject,
} from "./verbs";
import { kernelCellVerbs } from "./verbs-cells";
/** Owns verb binding, dispatch, reviews, controls and completion delivery. */
export function createMountVerbs<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  target: MountTarget<W>,
  page: MountPage<P, W>,
  readings: MountReadings<P, W>,
  work: MountWork<P, W>,
  history: MountTimeline<W>,
) {
  const { timeline } = history;
  // Validation ran above: cell verb ids cannot collide with graph verbs, so a plain spread is safe.
  const kernel = kernelCellVerbs(graph);
  const verbs: Readonly<Record<string, VerbDecl>> = {
    ...graph.verbs,
    ...kernel.verbs,
  };
  let invoking: { verb: string; input: MountBinding } | null = null;
  const dispatches = new Map<
    string,
    {
      key: WorkKey | null;
      verb: string;
      input: MountBinding | null;
      readings: readonly string[];
      attempts: Map<string, ReadingAttempt>;
      origin: string;
    }
  >();
  const reviews = new Map<string, { verb: string; ticket: ReviewTicket; origin: string }>();
  const paneRows = new Map<string, unknown>();
  const results = new Map<string, VerbCompletion>();
  let active: string | null = null;
  let activeOrigin = "";
  const context: VerbContext<"human"> = {
    caller: "human",
    environment: { reads: readings.legacyReads, commands: work.legacyCommands },
    acceptance: target.acceptance,
    receipt: (receipt, press) => {
      history.acceptReceipt(receipt, dispatches.get(press)?.key ?? null, press, false);
      history.sequenceReceipts.set(press, [
        ...(history.sequenceReceipts.get(press) ?? []),
        receipt,
      ]);
    },
    page: () => page.view.read().page as Record<string, unknown>,
    landReview: (patch) => page.view.setPage(patch as Partial<P>),
    readings: () =>
      Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)])),
    subjects: { ...adapters.subjects, ...kernel.subjects },
    snapshot: (verb) => {
      target.acceptance.observe(work.scope.work);
      return {
        failure: work.scope.failure,
        closed: work.scope.closed,
        target: work.scope.target,
        work: target.acceptance.readWork(),
        basis: {
          pageEpoch: page.view.read().epoch,
          // Only the readings this verb declares; see VerbContext.snapshot.
          readings: verb ? readings.basisFor(adapters.verbDepends?.[verb] ?? []) : readings.basis(),
        },
      };
    },
    write: (key, envelope, history, sequential) =>
      work.write(key, { ...envelope, kind: "apply" }, history, sequential),
    changed: () => target.notify(),
    owner: {
      runAction: (name, execute, keys, stopped, label, wait) =>
        page.base.runAction(
          name,
          async (cancelWith, press) => {
            const id = active!;
            const key = work.scope.work ? structuredClone(work.scope.work.handle.key) : null;
            if (key) work.journalFor(key);
            const ids = adapters.verbReadings?.[id] ?? [];
            const attempts = new Map<string, ReadingAttempt>();
            dispatches.set(press, {
              key,
              verb: id,
              input: invoking?.verb === id ? structuredClone(invoking.input) : null,
              readings: ids,
              attempts,
              origin: activeOrigin,
            });
            timeline.append({
              kind: "invocation",
              at: Date.now(),
              press,
              verb: id,
              outcome: { id: press, state: "running", input: invoking?.input ?? null },
              basis: { workKey: key ? workKey(key) : null },
            });
            for (const reading of ids)
              attempts.set(
                reading,
                readings.start(
                  reading,
                  press,
                  !(
                    verbs[id]?.kind === "query" &&
                    graph.readings[reading]?.query === verbs[id]?.does
                  ),
                ),
              );
            return execute(cancelWith, press);
          },
          keys,
          stopped,
          label,
          wait,
        ),
    },
  };
  /**
   * The core sees one verb at a time; its snapshot basis is that verb's declared readings. One
   * context per verb for the owner's life: the core keys open reviews by context identity.
   */
  const contexts = new Map<string, VerbContext<"human">>();
  const ctxFor = (id: string): VerbContext<"human"> => {
    let own = contexts.get(id);
    if (!own) {
      own = { ...context, snapshot: () => context.snapshot(id) };
      contexts.set(id, own);
    }
    return own;
  };
  const consume = (id: string, delivered: VerbDelivery) => {
    const result =
      "outcome" in delivered
        ? (delivered as VerbCompletion)
        : completeVerb(delivered, invoking?.input ?? null);
    if (target.disposed) return result;
    results.set(id, result);
    if (result.press) timeline.outcome(result.press, result.outcome);
    if (result.state === "review")
      reviews.set(id, {
        verb: id,
        ticket: result.ticket,
        origin: dispatches.get(result.press)!.origin,
      });
    else {
      // A refused commit keeps its authentic review open while the invocation is active.
      const review = reviews.get(id);
      if (
        review &&
        result.state === "refused" &&
        dispatches.has(review.ticket.press) &&
        page.registry.get(page.base.busy)
      ) {
        target.notify();
        return result;
      }
      reviews.delete(id);
      if (result.press) {
        const dispatch = dispatches.get(result.press);
        if (dispatch && "page" in result && result.page)
          page.view.setPage(result.page as Partial<P>);
        if (
          dispatch &&
          result.state === "done" &&
          (result.kind === "query" || result.kind === "rpc")
        ) {
          timeline.append({
            kind: "receipt",
            at: Date.now(),
            press: result.press,
            verb: id,
            receiptId: `query:${result.press}`,
            basis: { workKey: dispatch.key ? workKey(dispatch.key) : null, query: result.receipt },
          });
          // A read that names its subject Work selects it through Page, the one carry the door follows.
          for (const reading of dispatch.readings)
            if (graph.readings[reading]?.query === result.receipt.key)
              readings.publish(
                reading,
                result.press,
                dispatch.attempts.get(reading)!,
                result.receipt.value,
              );
          if (result.receipt.subject !== null && graph.workSubject)
            page.view.setPage({ [graph.workSubject]: result.receipt.subject } as Partial<P>);
        }
        if (dispatch) {
          // This press's own intermediate effects retire readings after the ordered reviews end.
          for (const receipt of history.sequenceReceipts.get(result.press) ?? [])
            readings.acceptReceipt(
              receipt,
              commands[receipt.key as keyof typeof commands]?.dirties ?? [],
            );
          history.sequenceReceipts.delete(result.press);
          if (
            "receipt" in result &&
            result.receipt &&
            !("kind" in result && (result.kind === "query" || result.kind === "rpc"))
          ) {
            if (["detached", "waiting", "running"].includes(result.receipt.state))
              history.unsettledWorks.set(result.receipt.id, dispatch.key);
            if (result.receipt.state !== "detached")
              history.acceptReceipt(result.receipt, dispatch.key, result.press);
          }
          for (const reading of dispatch.readings) {
            if (graph.readings[reading]?.query === verbs[id]?.does && "refusal" in result)
              readings.fail(
                reading,
                result.press,
                dispatch.attempts.get(reading)!,
                result.refusal.message,
              );
            readings.finish(reading, result.press);
          }
          dispatches.delete(result.press);
        }
      }
    }
    target.notify();
    return result;
  };
  const bindingScope = (): BindingScope<P, W> => ({
    ...work.scope,
    page: page.view.read().page,
    readings: Object.fromEntries(Object.keys(graph.readings).map((id) => [id, readings.get(id)])),
  });
  const cellSubject = (row: unknown): VerbSubject | null => {
    const subject = row === undefined ? null : (adapters.cell?.(row, bindingScope()) ?? null);
    if (subject && !kernel.placement[subject.type])
      throw Error(`Row resolved unknown cell type '${subject.type}'`);
    return subject;
  };
  const binding = (id: string, row?: unknown): MountBinding => {
    if (kernel.verbs[id]) return { subject: cellSubject(row), args: {} };
    return adapters.binding?.(id, row, bindingScope()) ?? { subject: null, args: {} };
  };
  // Writing verbs wait out a work.conflict; queries only read, so they still run.
  /** A failed dependency names its failure; it never reads as "refreshing". */
  const failedDependency = (id: string) => {
    for (const reading of adapters.verbDepends?.[id] ?? []) {
      const state = readings.get(reading);
      if (state.status === "failed") return `${reading} failed: ${state.error ?? "unknown error"}`;
    }
    return null;
  };
  const blocked = (id: string) =>
    target.disposed || !target.available()
      ? "This route is inactive"
      : work.conflict && work.scope.conflict && verbs[id]?.effect !== "query"
        ? CONFLICT_REFUSAL
        : failedDependency(id);
  const retryRefusal = () => {
    if (!work.rejected) return "There is no unaccepted edit";
    if (work.scope.closed || work.scope.failure) return work.scope.failure ?? "This Work is closed";
    const inactive = blocked(work.rejected.verb);
    if (inactive) return inactive;
    if (page.registry.get(page.base.busy)) return "Wait for the running verb";
    const currentWork = work.scope.work;
    if (!currentWork || workKey(currentWork.handle.key) !== workKey(work.rejected.key))
      return "Return to the Work that owns this edit";
    return currentWork.handle.revision <= work.rejected.request.expectedRevision
      ? "Read current Work before retrying"
      : null;
  };
  const run = async (id: string, bound: MountBinding, origin: string): Promise<VerbCompletion> => {
    const inactive = blocked(id);
    if (inactive)
      return completeVerb(
        {
          state: "refused" as const,
          press: null,
          refusal: refuse("not-ready", inactive),
        },
        bound.args,
      );
    const verb = verbs[id];
    if (!verb) throw Error(`Unknown verb ${id}`);
    const review = reviews.get(id);
    const stage = !review && adapters.stageBefore?.(id, bound, bindingScope());
    if (stage) {
      if (verbs[stage.verb]?.kind !== "work") throw Error("Command staging requires a Work verb");
      const staged = await run(stage.verb, { subject: null, args: stage.input }, origin);
      if (staged.state !== "done") return staged;
      if (staged.kind !== "work") throw Error("Staging returned no Work acknowledgement");
      const acknowledgement = staged.acknowledgement;
      const started = target.acceptance.capture();
      // The host acknowledgement can beat the Work subscription. Never bind the next command to
      // the old revision, or invent a second local Work document from the submitted patches.
      const observed = await new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timeout);
          target.listeners.delete(check);
          resolve(ok);
        };
        const check = () => {
          if (target.disposed || !target.acceptance.current(started)) return finish(false);
          if (
            work.scope.work &&
            workKey(work.scope.work.handle.key) === workKey(acknowledgement.key) &&
            work.scope.work.handle.revision >= acknowledgement.revision
          )
            finish(true);
        };
        const timeout = setTimeout(() => finish(false), 10_000);
        target.listeners.add(check);
        check();
      });
      if (!observed)
        return completeVerb(
          {
            state: "refused",
            press: null,
            refusal: refuse(
              "not-ready",
              "The staged Work has not arrived; read Work before previewing",
            ),
          },
          bound.args,
        );
    }
    // Another press cannot steal the running invocation's identity.
    active = id;
    activeOrigin = origin;
    invoking = { verb: id, input: structuredClone(bound) };
    const result = review
      ? await commit(ctxFor(id), verb, review.ticket)
      : await invoke(ctxFor(id), verb, bound.subject, bound.args);
    return consume(id, result);
  };
  const cancelReviews = () => {
    for (const { verb, ticket } of reviews.values())
      void invoke(ctxFor(verb), verbs[verb]!, ticket.subject, ticket.input, {
        kind: "cancel",
        ticket,
      }).then((result) => consume(verb, result));
    reviews.clear();
  };
  return {
    results,
    reviews,
    commitReview(id: string, ticket: ReviewTicket) {
      const review = reviews.get(id);
      if (review?.ticket !== ticket) return Promise.resolve(undefined);
      return run(id, { subject: ticket.subject, args: ticket.input }, review.origin);
    },
    context,
    dispatches,
    cancelReviews,
    busy: () => page.registry.get(page.base.busy),

    paneRows,
    /** Graph verbs plus the kernel's cell verbs; the one table every lookup reads. */
    verbs,
    /**
     * The verb ids the Situation draws.
     */
    stageVerbs(): readonly string[] {
      const own = graph.stages[page.stage()]!.verbs;
      return [...own, ];
    },
    /** Reads the current Work again, which is what ends a conflict. */
    reread() {
      if (work.scope.work) adapters.reread?.(work.scope.work.handle.key);
    },
    rejected: () => work.rejected,
    retryRefusal,
    discard() {
      if (work.rejected?.request.press)
        work.writers.get(workKey(work.rejected.key))?.discard(work.rejected.request.press);
      work.rejected = null;
      target.notify();
    },
    async retry() {
      const edit = work.rejected;
      const currentWork = work.scope.work;
      if (!edit || !currentWork || retryRefusal()) return;
      active = edit.verb;
      activeOrigin = "retry";
      invoking = { verb: edit.verb, input: edit.input };
      await context.owner.runAction(edit.verb, async (_cancel, press) => {
        try {
          const result = await work.write(currentWork.handle.key, {
            ...edit.request,
            expectedRevision: currentWork.handle.revision,
            press,
          });
          if (result.ok) {
            if (edit.request.press)
              work.writers.get(workKey(edit.key))?.discard(edit.request.press);
            if (work.rejected === edit) work.rejected = null;
            consume(edit.verb, {
              state: "done",
              kind: "work",
              press,
              acknowledgement: result.write,
            });
            return null;
          }
          const refusal = writeRefusal(result)!;
          consume(edit.verb, { state: "refused", press, refusal });
          return refusal;
        } catch (cause) {
          const refusal = causeRefusal(cause);
          consume(edit.verb, { state: "failed", press, refusal });
          return refusal;
        }
      });
      target.notify();
    },
    /** Chord-free cell verb ids a row carries (palette and row menu only); [] when it is no cell. */
    cellVerbs: (row: unknown): readonly string[] => {
      const subject = cellSubject(row);
      return subject ? kernel.placement[subject.type]! : [];
    },
    focusRow(pane: string, row: unknown) {
      if (Object.is(paneRows.get(pane), row)) return;
      paneRows.set(pane, row);
      target.notify();
    },
    binding,
    control(id: string, row?: unknown, place = "stage") {
      const bound = structuredClone(binding(id, row));
      // A control's identity is where it sits (place, row, subject), never its args: a binding
      // reads current readings and Work, so args change after a write while the review must stay
      // at its control for the core staleness check to run. Cross-row commits stay refused.
      const origin = canonicalRouteInput([place, row ?? null, bound.subject]);
      const control = bind(verbs[id]!, { ctx: ctxFor(id), ...bound });
      const reason = () =>
        blocked(id) ??
        (reviews.has(id)
          ? reviews.get(id)!.origin === origin
            ? null
            : "Finish this verb's review at its original control"
          : control.refusal);
      return {
        ...control,
        get refusal() {
          return reason();
        },
        get review() {
          const review = reviews.get(id);
          return review?.origin === origin ? review : undefined;
        },
        run: () => {
          const refusal = reason();
          return refusal
            ? Promise.resolve(
                consume(id, {
                  state: "refused",
                  press: null,
                  refusal: refuse("not-ready", refusal),
                }),
              )
            : run(id, bound, origin);
        },
      };
    },
    stop() {
      for (const [press, dispatch] of dispatches)
        for (const reading of dispatch.readings) readings.cancel(reading, press);
      if (reviews.size) cancelReviews();
      else page.base.stop();
    },
    async checkpoint() {
      if (!adapters.checkpoint || target.disposed || !target.available()) return;
      const frozen = structuredClone({
        scope: work.scope,
        page: page.view.read().page,
        readings: readings.basis(),
      });
      const fact = await adapters.checkpoint(frozen);
      if (!target.disposed) timeline.append({ ...fact, kind: "checkpoint" });
    },
  };
}
export type MountVerbs<P, W> = ReturnType<typeof createMountVerbs<P, W>>;
