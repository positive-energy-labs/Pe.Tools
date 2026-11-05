import { freezePage } from "./page-port";
import { workFeedFailureMessage } from "../../../../packages/agent-contracts/src/work-journal-door";
import { completion } from "./work-door-observation";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type {
  WorkJournalDoor,
  WorkScope,
  Observation,
  WorkWriteOutcome,
  WorkFeedFailure,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment";

type Owner = ReturnType<typeof createRouteScopeGate>;
/** B remains the only publisher. This owner connects its scope to one feed. */
export function createAdmittedWork(
  route: AdmittedRoute,
  owner: Owner,
  door: WorkJournalDoor | undefined,
  requireWritable: () => void,
  notify: () => void,
  restoreHistory: (
    key: WorkScope["key"],
    state: Extract<
      import("../../../../packages/agent-contracts/src/work-journal-door").WorkFeedState,
      { kind: "ready" }
    >,
  ) => void,
  connectReceipts: (scope: WorkScope) => void = () => {},
  refusalsFor?: (
    key: WorkScope["key"],
  ) => Map<string, import("./application-work-registry").RefusedWorkEdit>,
) {
  const submitWork: WorkJournalDoor["submitWork"] = (...args) => {
    requireWritable();
    return door!.submitWork(...args);
  };
  const localRefusals = new Map<string, import("./application-work-registry").RefusedWorkEdit>();
  const refusals = (key = scope?.key) => (key && refusalsFor ? refusalsFor(key) : localRefusals);
  let stop = () => {};
  let scopeToken: ReturnType<Owner["capture"]>["scope"] | undefined;
  let feedToken: ReturnType<Owner["capture"]> | undefined;
  let scope: WorkScope | undefined;
  let ready = false;
  let problem: string | null = null;
  let failure: WorkFeedFailure | null = null;
  let reloadRequired = false;
  let reopened: ((error?: string) => void) | undefined;
  const sync = () => {
    const snapshot = owner.read();
    if (reloadRequired || !snapshot || snapshot.scope === scopeToken) return;
    stop();
    if (scopeToken) {
      reopened?.("Work scope changed");
      reopened = undefined;
    }
    problem = null;
    failure = null;
    ready = false;
    scopeToken = snapshot.scope;
    const key = snapshot.scope.identity.work;
    if (!door || !key) return;
    scope = {
      route: route.resolvedWork!.spec.route,
      fingerprint: route.workFingerprint,
      key,
      target: snapshot.scope.identity.target,
      subject: snapshot.page[route.data.subject.field] as WorkScope["subject"],
    };
    const capturedScope = scope;
    connectReceipts(scope);
    const token = owner.capture("work-feed");
    feedToken = token;
    let feedEnded = false;
    stop = door.open(scope).subscribe(
      (state) => {
        if (feedEnded || !owner.current(token)) return;
        if (state.kind === "pending" || state.kind === "gap") {
          ready = false;
          notify();
        }
        if (state.kind === "failed") {
          ready = false;
          feedEnded = true;
          failure = state.failure;
          reloadRequired = state.failure.kind === "registration-mismatch";
          problem = workFeedFailureMessage(state.failure);
          reopened?.(problem);
          reopened = undefined;
          notify();
        }
        if (state.kind === "ready") {
          const result = owner.acceptWork(token, {
            kind: "snapshot",
            key: capturedScope.key,
            revision: state.snapshot.revision,
            value: state.snapshot.value,
            hash: canonicalEnvironmentInput(state.snapshot.value),
          });
          problem = null;
          failure = null;
          ready = result.kind === "published" || result.kind === "duplicate";
          if (ready && owner.read()?.work?.revision === state.snapshot.revision)
            restoreHistory(capturedScope.key, state);
          reopened?.(ready ? undefined : "Work snapshot refused");
          reopened = undefined;
          notify();
        }
        if (state.kind === "ack") {
          const result = owner.acceptWork(token, { kind: "stream", write: state.ack });
          if (result.kind === "recover") {
            ready = false;
            problem = `Work ${result.reason}`;
          }
        }
      },
      () => {},
    );
  };
  const write = (
    patches: () => import("@pe/agent-contracts").WorkWrite["patches"],
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
    press: string,
    detail: Pick<import("@pe/agent-contracts").WorkWrite, "label" | "meta">,
    basis: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken = invocation,
  ): Observation<WorkWriteOutcome> => {
    if (!scope || !door || !ready || basis.workRevision === null) throw Error("Work unavailable");
    const original = scope;
    const retainedRefusals = refusals(original.key);
    const request = freezePage({
      kind: "apply" as const,
      expectedRevision: basis.workRevision,
      patches: structuredClone(patches()),
      press,
      ...detail,
    });
    // Admit synchronously: observation disposal cannot revoke a submitted write.
    const observation = submitWork(original, request, basis);
    return completion<WorkWriteOutcome>(
      { kind: "pending" },
      () =>
        new Promise((resolve) => {
          observation.subscribe(
            (value) => {
              if (value.kind === "pending") return;
              if (value.kind === "accepted")
                owner.acceptWork(invocation, { kind: "ack", write: value.ack });
              else {
                retainedRefusals.set(invocation.id, {
                  input: request,
                  basis,
                  refusal: value.refusal,
                });
                if (owner.read()?.scope === invocation.token.scope) problem = value.refusal.error;
              }
              if (owner.read()?.scope === invocation.token.scope) notify();
              resolve(value);
            },
            () => {},
          );
        }),
    );
  };
  // ADR 0030 rule 9: a foreign cell lands in its owner's journal through the declared reading's
  // handle. The owner's revision fences it; its feed ack, not this scope, is the truth.
  const writeTo = (
    handle: import("@pe/agent-contracts").WorkHandle,
    reading: string,
    patches: import("@pe/agent-contracts").WorkWrite["patches"],
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
    detail: Pick<import("@pe/agent-contracts").WorkWrite, "label" | "meta">,
  ): Observation<WorkWriteOutcome> => {
    if (!scope || !door) throw Error("Owner Work unavailable");
    const request = freezePage({
      kind: "apply" as const,
      expectedRevision: handle.revision,
      patches: structuredClone(patches),
      press: invocation.id,
      ...detail,
    });
    return submitWork({ ...scope, reading, key: handle.key, subject: null }, request, invocation);
  };
  // Replay is never recomputed over a concurrent edit: return the door's stale refusal.
  const submit = (
    request: import("@pe/agent-contracts").WorkWrite,
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
  ): Promise<import("@pe/agent-contracts").RouteStateWriteResult> => {
    if (!scope || !door || !ready || !owner.current(invocation)) throw Error("Work unavailable");
    const original = scope;
    return new Promise((resolve) => {
      submitWork(original, request, invocation).subscribe(
        (outcome) => {
          if (outcome.kind === "pending") return;
          if (outcome.kind === "accepted") {
            owner.acceptWork(invocation, { kind: "ack", write: outcome.ack });
            resolve({ ok: true, revision: outcome.ack.revision, write: outcome.ack });
          } else {
            problem = outcome.refusal.error;
            resolve({
              ok: false,
              kind: "refused",
              error: outcome.refusal.error,
              hint: outcome.refusal.hint,
              code: outcome.refusal.code === "stale_revision" ? "stale_revision" : undefined,
              ...("revision" in outcome.refusal && { revision: outcome.refusal.revision }),
            });
          }
          notify();
        },
        () => {},
      );
    });
  };
  return {
    sync,
    write,
    writeTo,
    refused: () =>
      Object.freeze(
        [...refusals()].map(([id, row]) =>
          Object.freeze({
            id,
            input: freezePage(row.input),
            basis: row.basis,
            refusal: freezePage(row.refusal),
          }),
        ),
      ),
    discard(id: string) {
      refusals().delete(id);
      notify();
    },
    retry(
      id: string,
      currentBasis: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
    ) {
      const row = refusals().get(id);
      if (!row || !owner.current(currentBasis) || !owner.current(row.basis))
        throw Error(
          "Retry needs the original, still-current basis; re-read and prepare changed Work explicitly",
        );
      return write(
        () => row.input.patches,
        row.basis,
        row.input.press!,
        {
          label: row.input.label ?? "Edit Work",
          ...(row.input.meta !== undefined && { meta: row.input.meta }),
        },
        row.basis,
      );
    },
    submit,
    reopen() {
      if (reloadRequired) return Promise.reject(Error(problem ?? "Reload this tab"));
      stop();
      if (feedToken) owner.retire(feedToken);
      scopeToken = undefined;
      return new Promise<void>((resolve, reject) => {
        reopened = (error) => (error ? reject(Error(error)) : resolve());
        sync();
      });
    },
    ready: () => ready,
    problem: () => problem,
    failure: () => failure,
    close() {
      ready = false;
      reopened?.("Work closed");
      reopened = undefined;
      stop();
      if (feedToken) owner.retire(feedToken);
    },
  };
}
