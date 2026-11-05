import {
  commands,
  workHandleSchema,
  writePreviewSchema,
  type SemanticActionKey,
} from "@pe/agent-contracts";
import { z } from "zod";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import {
  presentationSchema,
  type PresentCell,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { InvocationToken } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { admittedWorkPatches } from "./admitted-cells.ts";
import { commandResultDecoder, type CommandResultDecode } from "./admitted-command-result.ts";
import type { MountContext } from "./admitted-context.ts";
import { project, projectEvidence, readingHashes } from "./admitted-context.ts";
import { placeAdmittedVerbs } from "./admitted-placement.ts";
import { createAdmittedRetention, InvocationOverload } from "./admitted-retention.ts";
import { freezePage } from "./page-port.ts";
import { reviewChanges } from "./review-value.ts";
export class ReviewRefusal extends Error {
  readonly kind = "refused";
  constructor(
    readonly reason: "review-stale" | "present-threw" | "present-invalid" | "plan-failed",
    detail?: string,
  ) {
    super(
      detail ??
        (reason === "review-stale" ? "Review is stale; prepare it again" : `Review refused: ${reason}`),
    );
    this.name = "ReviewRefusal";
  }
}
type PresentationEvidence = ReturnType<typeof projectEvidence>;

export function createAdmittedInvocation<W extends Record<string, unknown>>(
  context: MountContext<W>,
) {
  const {
    route,
    owner,
    read,
    bindings,
    input: { target },
    action,
    resolve,
    notify,
    schedule,
    submitNative,
    entryFor,
    sourceTimeline,
    now,
  } = context;
  const work = context.work();
  const { snapshots, beginQuery, workHandles } = context.readings();

  const preparing = createAdmittedRetention<{
    invocation: import("../../../../packages/agent-contracts/src/route-kernel-page.ts").InvocationToken;
    reading: string;
    handle: string;
    evidence(): PresentationEvidence;
    send(): unknown;
  }>({ entries: Object.keys(route.data.verbs).length, bytes: 1024 * 1024 });
  const reviews = new Map<
    string,
    {
      invocation: import("../../../../packages/agent-contracts/src/route-kernel-page.ts").InvocationToken;
      send(): unknown;
      preview: unknown;
      presentation?: { sentence: string; rows: readonly string[]; cells?: readonly PresentCell[] };
    }
  >();
  const reviewRefusals = new Map<string, ReviewRefusal>();
  let presenting = false;
  const present = (
    id: string,
    result: unknown,
    evidence: PresentationEvidence,
    body = route.data.verbs[id]?.present,
  ) => {
    if (!body) return undefined;
    let value: unknown;
    presenting = true;
    try {
      value = bindings.bodies[body]!.run(freezePage(result), evidence);
    } catch {
      const refusal = new ReviewRefusal("present-threw");
      reviewRefusals.set(id, refusal);
      throw refusal;
    } finally {
      presenting = false;
    }
    const parsed = presentationSchema.safeParse(value);
    if (!parsed.success) {
      const refusal = new ReviewRefusal("present-invalid");
      reviewRefusals.set(id, refusal);
      throw refusal;
    }
    return freezePage(
      typeof parsed.data === "string" ? { sentence: parsed.data, rows: [] } : parsed.data,
    );
  };
  const place = (pane: string, row: unknown, input: unknown, basis?: InvocationToken | null) => {
    action();
    resolve();
    const declaration = route.data.panes[pane];
    if (!declaration) throw Error(`Unknown pane: ${pane}`);
    return placeAdmittedVerbs(
      declaration,
      bindings.schemas,
      bindings.bodies,
      row,
      input,
      (id, input) => invoke(id, input, basis ?? undefined),
    );
  };
  const editBases = new WeakMap<InvocationToken, NonNullable<ReturnType<typeof owner.read>>>();
  let renderedBasis: InvocationToken | null = null;
  const workBasis = () => {
    const snapshot = owner.read();
    if (!snapshot?.work || !work.ready()) return null;
    if (renderedBasis && editBases.get(renderedBasis) === snapshot) return renderedBasis;
    const issued = owner.invocation(owner.capture(`rendered-work:${crypto.randomUUID()}`), {});
    if (!issued.ok) throw Error(issued.reason);
    renderedBasis = issued.value;
    editBases.set(renderedBasis, snapshot);
    return renderedBasis;
  };
  const landings = createAdmittedRetention<CommandResultDecode>({
    entries: 128,
    bytes: 1024 * 1024,
  });
  const invoke = (id: string, input: unknown, basis?: InvocationToken) => {
    action();
    resolve();
    reviewRefusals.delete(id);
    const declaration = route.data.verbs[id];
    if (!declaration) throw Error(`Unknown verb: ${id}`);
    const parsed = bindings.schemas[declaration.input]!.parse(input);
    const edit = basis === undefined ? undefined : editBases.get(basis);
    if (basis !== undefined && (!edit || edit.scope !== owner.read()?.scope))
      throw Error("Stale or foreign accepted Work basis");
    if (declaration.deps.work.length && (!work.ready() || !read().work))
      throw Error("Work unavailable");
    const dependencies = readingHashes(declaration.deps.readings, snapshots());
    const issued = owner.invocation(owner.capture(`verb:${id}`), dependencies);
    if (!issued.ok) throw Error(issued.reason);
    const invocation = issued.value;
    const context = () => ({
      workBasis: basis ?? (owner.read()?.work ? invocation : null),
      ...projectEvidence(
        declaration.deps,
        read().page,
        (edit?.work ?? read().work)?.value ?? {},
        snapshots(),
      ),
      captures: project(declaration.captures, snapshots()),
    });
    if (declaration.ready) {
      const ready = bindings.bodies[declaration.ready]!.run(context(), parsed);
      if (ready !== true) throw Error(String(ready));
    }
    let preview: unknown;
    let send: () => unknown;
    if (declaration.kind === "work") {
      let detail: Pick<import("@pe/agent-contracts").WorkWrite, "label" | "meta"> = {
        label: declaration.label,
      };
      if (declaration.describe) {
        const evidence = context();
        try {
          const described = bindings.bodies[declaration.describe]!.run(
            freezePage(parsed),
            freezePage({
              page: evidence.page,
              work: evidence.work,
              readings: evidence.readings,
            }),
          );
          // The admitted declaration owns the return shape; the host decodes untrusted meta.
          detail = described as typeof detail;
        } catch {
          return { kind: "refused", reason: "describe-threw" } as const;
        }
      }
      const target = declaration.target;
      const reading = target === undefined ? undefined : route.data.readings[target];
      const handle = target === undefined ? undefined : Object.values(workHandles([target]))[0];
      if (target !== undefined && (reading?.kind !== "work" || !handle))
        throw Error("Owner Work unavailable");
      const patches = admittedWorkPatches(
        route.data,
        bindings.schemas,
        bindings.bodies[declaration.patches]!.run(context(), parsed),
        reading?.kind === "work" ? bindings.schemas[reading.output] : route.resolvedWork!.schema,
      );
      preview = patches;
      send = () => {
        const observation = handle
          ? work.writeTo(handle, target!, patches, invocation, detail)
          : work.write(() => patches, invocation, invocation.id, detail, basis);
        observation.subscribe(
          () => {
            if (owner.read()?.scope === invocation.token.scope) notify();
          },
          () => {},
        );
        return observation;
      };
    } else if (declaration.kind === "command") {
      const entry = bindings.entries[declaration.entry]!;
      const modelWrite = entry.axes.effect === "ModelWrite";
      // Reading owners retain the exact bodies. Re-project only after owner.current verifies
      // this invocation's Work revision and reading hashes; do not retain a second full copy.
      const evidence = () => {
        const captured = context();
        return Object.freeze({ page: captured.page, work: captured.work, readings: captured.readings });
      };
      const accepted = read();
      if (modelWrite && basis && basis.workRevision !== accepted.work?.revision)
        throw Error("Stale accepted Work basis; prepare from the current revision");
      // The command's owner chooses the primary Work; every handle comes from accepted state.
      const command = Object.hasOwn(commands, declaration.entry)
        ? commands[declaration.entry as SemanticActionKey]
        : undefined;
      const handles = workHandles(declaration.deps.readings);
      if (accepted.work && accepted.scope.identity.work && work.ready())
        handles[accepted.work.handle.key.route] = accepted.work.handle;
      const workRoute = command && "writeBoundary" in command
        ? command.writeBoundary.route
        : accepted.scope.identity.work?.route;
      const primaryWork = workRoute ? handles[workRoute] : undefined;
      if (modelWrite && !primaryWork) throw Error("Accepted owner Work unavailable");
      // ModelWrite has one input authority: its accepted owner's handle, never draft intent.
      const declaredIntent = z
        .record(z.string(), z.unknown())
        .parse(bindings.bodies[declaration.intent]!.run(context(), parsed));
      if (
        modelWrite &&
        (Object.hasOwn(declaredIntent, "work") || Object.hasOwn(declaredIntent, "readWorks"))
      )
        throw Error("ModelWrite intent cannot supply Work identity");
      const readWorks = Object.fromEntries(
        Object.entries(handles).filter(([route]) => route !== workRoute),
      );
      const intent = freezePage(
        z.record(z.string(), z.unknown()).parse(
          entry.input.parse(
            modelWrite
              ? {
                  ...declaredIntent,
                  ...(Object.keys(readWorks).length ? { readWorks } : {}),
                  work: primaryWork,
                }
              : declaredIntent,
          ),
        ),
      );
      preview = freezePage({ work: accepted.work, input: intent });
      // ActionJournal owns the existing Reject? consent window after this admission.
      send = () => {
        // A press is visible before ActionJournal delivers its receipt. Keep identity, not a label.
        const key = accepted.scope.identity.work;
        const timelineOwner = key ? entryFor(key) : owner;
        const starts = sourceTimeline.get(timelineOwner) ?? [];
        starts.push({
          kind: "invocation", at: now(), press: invocation.id, verb: id,
          outcome: { id: invocation.id, state: "running", input: intent },
        });
        if (starts.length > 200) starts.shift();
        sourceTimeline.set(timelineOwner, starts);
        notify();
        const submission = submitNative({
          id: invocation.id,
          key: declaration.entry,
          target: target ?? { kind: "host" },
          input: intent,
        });
        if (declaration.lands) {
          const decode = commandResultDecoder(submission, bindings.entries);
          const land = bindings.bodies[declaration.lands]!.run;
          submission.accepted.subscribe(
            (outcome) => {
              if (outcome.kind === "pending") return;
              const result = decode(outcome);
              if (landings.set(submission.handle.id, result).kind === "overload") {
                landings.clear();
                landings.set(submission.handle.id, result);
              }
              if (result.kind === "decoded" && owner.current(invocation)) {
                const patch = land(freezePage(result.value), read().page);
                owner.acceptPage(invocation, patch as Parameters<typeof owner.acceptPage>[1]);
              }
              notify();
            },
            () => {},
          );
        }
        return submission;
      };
      if (modelWrite) {
        const previewKey =
          command && "writeBoundary" in command
            ? command.writeBoundary.previewKey
            : `${declaration.entry}.preview`;
        const previewEntry = bindings.entries[previewKey];
        // ADR 0030 rule 4: the plan is a Read, or a rehearsal that rolls back.
        if (
          !previewEntry ||
          !(
            previewEntry.axes.effect === "Read" ||
            (previewEntry.axes.effect === "TransactRead" && previewEntry.axes.rollsBack)
          )
        )
          throw Error("ModelWrite requires its catalog plan");
        const candidates = Object.entries(route.data.readings).filter(
          ([, reading]) =>
            reading.kind === "use" && reading.entry === previewKey && reading.demand === "explicit",
        );
        if (candidates.length !== 1)
          throw Error("ModelWrite preview must identify exactly one explicit reading");
        previewEntry.input.parse(intent);
        const readingId = candidates[0]![0];
        reviews.delete(id);
        const retained = preparing.set(id, {
          evidence,
          invocation,
          reading: readingId,
          handle: canonicalEnvironmentInput(intent.work),
          send: () => {
            if (!work.ready() || !owner.current(invocation))
              throw new ReviewRefusal("review-stale");
            return send();
          },
        });
        if (retained.kind === "overload") throw new InvocationOverload("preparing");
        beginQuery(readingId, { input: intent, invocation }, false);
        const review = reviews.get(id);
        return review ? { kind: "review", preview: review.preview } : { kind: "preview" };
      }
    } else if (declaration.kind === "page") {
      const patch = bindings.bodies[declaration.patch]!.run(context(), parsed);
      preview = patch;
      send = () => owner.acceptPage(invocation, patch as Parameters<typeof owner.acceptPage>[1]);
    } else {
      const entry = bindings.entries[declaration.entry]!;
      const args = freezePage(
        entry.input.parse(bindings.bodies[declaration.args]!.run(context(), parsed)),
      );
      const targets = Object.entries(route.data.readings).filter(
        ([id, reading]) =>
          reading.kind !== "derive" &&
          reading.kind !== "work" &&
          reading.entry === declaration.entry &&
          (declaration.reading === undefined || declaration.reading === id),
      );
      if (targets.length !== 1)
        throw Error("Query entry must identify exactly one declared reading");
      const [readingId] = targets[0]!;
      preview = args;
      send = () => {
        beginQuery(readingId, {
          input: args,
          invocation,
          landing: declaration.lands,
          inputsCurrent: () => {
            try {
              // workBasis stays at the read's starting revision, including expectedRevision.
              const current = entry.input.parse(
                bindings.bodies[declaration.args]!.run(
                  {
                    ...context(),
                    work: project(declaration.deps.work, read().work?.value ?? {}),
                  },
                  parsed,
                ),
              );
              return canonicalEnvironmentInput(current) === canonicalEnvironmentInput(args);
            } catch {
              return false;
            }
          },
        });
      };
    }
    const dispatch = () => {
      if (!owner.current(invocation)) throw new ReviewRefusal("review-stale");
      return send();
    };
    if (declaration.review === "shown") {
      reviews.set(id, { invocation, preview, send: dispatch });
      notify();
      return { kind: "review", preview };
    }
    return dispatch();
  };

  return {
    invoke,
    place,
    workBasis,
    present,
    reviews,
    presenting: () => presenting,
    sync() {
      for (const [id, pending] of preparing.entries()) {
        if (!owner.current(pending.invocation)) {
          preparing.delete(id);
          reviewRefusals.set(id, new ReviewRefusal("review-stale"));
          continue;
        }
        const result = snapshots()[pending.reading];
        // beginQuery retired the prior reading, so a failure here is this invocation's own plan.
        if (result?.status === "failed") {
          preparing.delete(id);
          reviewRefusals.set(id, new ReviewRefusal("plan-failed", result.reason));
          continue;
        }
        if (!result?.current) continue;
        preparing.delete(id);
        const sealed = writePreviewSchema.parse(result.value);
        const handle = z.object({ handle: workHandleSchema }).parse(sealed.seal.work).handle;
        if (canonicalEnvironmentInput(handle) !== pending.handle)
          throw Error("Preview sealed a different Work handle");
        const presentation = present(id, sealed, pending.evidence());
        if (!owner.current(pending.invocation)) {
          reviewRefusals.set(id, new ReviewRefusal("review-stale"));
          continue;
        }
        reviews.set(id, {
          presentation,
          invocation: pending.invocation,
          preview: result.value,
          send: () => pending.send(),
        });
      }
    },
    landings: () => [...landings.values()],
    commandLanding: (
      id: string,
    ): CommandResultDecode | { kind: "gap"; reason: string; receiptId: string } =>
      landings.get(id) ?? { kind: "gap", reason: "Read the durable action receipt", receiptId: id },
    public: {
      review: (id: string) => {
        const review = reviews.get(id);
        if (!review) return null;
        const stale = (!!route.data.work && !work.ready()) || !owner.current(review.invocation);
        return {
          preview: stale ? undefined : review.preview,
          sentence: stale ? null : (review.presentation?.sentence ?? null),
          rows: stale ? [] : (review.presentation?.rows ?? reviewChanges(review.preview)),
          cells: stale ? [] : (review.presentation?.cells ?? []),
          stale,
        };
      },
      reviewRefusal: (id: string) => {
        const review = reviews.get(id);
        return review && ((!!route.data.work && !work.ready()) || !owner.current(review.invocation))
          ? new ReviewRefusal("review-stale")
          : (reviewRefusals.get(id) ?? null);
      },
      reviewIds: () => Array.from(reviews.keys()),
      cancelReview: (id: string) => {
        const invocation = preparing.get(id)?.invocation ?? reviews.get(id)?.invocation;
        if (invocation) owner.retire(invocation.token);
        preparing.delete(id);
        reviews.delete(id);
        reviewRefusals.delete(id);
        schedule();
      },
      confirm: (id: string) => {
        const review = reviews.get(id);
        if (!review) throw reviewRefusals.get(id) ?? Error("No review to confirm");
        const result = review.send();
        reviews.delete(id);
        notify();
        return result;
      },
    },
  };
}
