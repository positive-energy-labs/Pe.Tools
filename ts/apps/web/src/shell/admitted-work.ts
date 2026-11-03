import { completion } from "./work-door-observation";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type {
  WorkJournalDoor,
  WorkScope,
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment";

type Owner = ReturnType<typeof createRouteScopeGate>;
/** B remains the only publisher. This owner connects its scope to one feed. */
export function createAdmittedWork(
  route: AdmittedRoute,
  owner: Owner,
  door: WorkJournalDoor | undefined,
  notify: () => void,
) {
  let stop = () => {};
  let scopeToken: ReturnType<Owner["capture"]>["scope"] | undefined;
  let feedToken: ReturnType<Owner["capture"]> | undefined;
  let scope: WorkScope | undefined;
  let ready = false;
  let problem: string | null = null;
  const rebases = new Set<{ revision: number; resume(): void; abandon(): void }>();
  const resumeRebase = () => {
    for (const pending of rebases) {
      if ((owner.read()?.work?.revision ?? -1) < pending.revision) continue;
      rebases.delete(pending);
      pending.resume();
    }
  };
  const abandonRebases = () => {
    for (const pending of rebases) pending.abandon();
    rebases.clear();
  };
  const sync = () => {
    const snapshot = owner.read();
    if (!snapshot || snapshot.scope === scopeToken) return;
    stop();
    abandonRebases();
    problem = null;
    ready = false;
    scopeToken = snapshot.scope;
    const key = snapshot.scope.identity.work;
    if (!door || !key) return;
    scope = {
      route: route.data.key,
      key,
      target: snapshot.scope.identity.target,
      subject: snapshot.page[route.data.subject.field] as WorkScope["subject"],
    };
    const capturedScope = scope;
    const token = owner.capture("work-feed");
    feedToken = token;
    stop = door.open(scope).subscribe(
      (state) => {
        if (!owner.current(token)) return;
        if (state.kind === "pending" || state.kind === "gap") {
          ready = false;
          notify();
        }
        if (state.kind === "failed") {
          ready = false;
          problem = state.failure.message;
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
          ready = result.kind === "published" || result.kind === "duplicate";
          resumeRebase();
          notify();
        }
        if (state.kind === "ack") {
          const result = owner.acceptWork(token, { kind: "stream", write: state.ack });
          if (result.kind === "recover") {
            ready = false;
            problem = `Work ${result.reason}`;
          }
          resumeRebase();
        }
      },
      () => {},
    );
  };
  const write = (
    patches: () => import("@pe/agent-contracts").WorkWrite["patches"],
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
    press: string,
    label: string,
  ): Observation<WorkWriteOutcome> => {
    if (!scope || !door || !ready) throw Error("Work unavailable");
    const original = scope;
    let request = {
      kind: "apply" as const,
      expectedRevision: owner.read()!.work!.revision,
      patches: patches(),
      press,
      label,
    };
    return completion<WorkWriteOutcome>(
      { kind: "pending" },
      () =>
        new Promise((resolve) => {
          let attempts = 0;
          const submit = () => {
            const observation = door!.submitWork(original, request, invocation);
            observation.subscribe(
              (value) => {
                if (value.kind === "pending") return;
                if (value.kind === "accepted")
                  owner.acceptWork(invocation, { kind: "ack", write: value.ack });
                if (
                  value.kind === "refused" &&
                  value.refusal.code === "stale_revision" &&
                  attempts++ === 0 &&
                  owner.current(invocation.token) &&
                  owner.read()?.pageEpoch === invocation.pageEpoch &&
                  owner.read()?.pageRevision === invocation.pageRevision
                ) {
                  const retry = () => {
                    if (
                      !owner.current(invocation.token) ||
                      owner.read()?.pageEpoch !== invocation.pageEpoch ||
                      owner.read()?.pageRevision !== invocation.pageRevision
                    ) {
                      resolve(value);
                      return;
                    }
                    const basis = owner.invocation(
                      owner.capture(`rebase:${press}`),
                      invocation.dependencies,
                      invocation.causalParent,
                    );
                    if (!basis.ok) {
                      resolve(value);
                      return;
                    }
                    invocation = basis.value;
                    request = {
                      ...request,
                      expectedRevision: owner.read()!.work!.revision,
                      patches: patches(),
                    };
                    submit();
                  };
                  if ((owner.read()?.work?.revision ?? -1) >= value.refusal.revision) retry();
                  else
                    rebases.add({
                      revision: value.refusal.revision,
                      resume: retry,
                      abandon: () => resolve(value),
                    });
                } else resolve(value);
              },
              () => {},
            );
          };
          submit();
        }),
    );
  };
  // Replay is never recomputed over a concurrent edit: return the door's stale refusal.
  const submit = (
    request: import("@pe/agent-contracts").WorkWrite,
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page").InvocationToken,
  ): Promise<import("@pe/agent-contracts").RouteStateWriteResult> => {
    if (!scope || !door || !ready || !owner.current(invocation)) throw Error("Work unavailable");
    const original = scope;
    return new Promise((resolve) => {
      door.submitWork(original, request, invocation).subscribe(
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
    submit,
    ready: () => ready,
    problem: () => problem,
    close() {
      ready = false;
      stop();
      abandonRebases();
      if (feedToken) owner.retire(feedToken);
    },
  };
}
