import {
  canonicalRouteInput,
  documentRefSchema,
  keptMachineLegAt,
  machineLegSchema,
  machineSchema,
  machineSessionSchema,
  workKey,
  workKeySchema,
} from "@pe/agent-contracts";
import { subscribePlaces } from "../places.ts";
import type { ResourceObserver, RouteWorkspace } from "@pe/runtime";
import { z } from "zod";
import type { HostMarks } from "../document-marks.ts";
import { workInput } from "@pe/host-internal/reads/evaluator";
import type { Publication, Publications } from "./publications.ts";
import { settingsFile } from "@pe/host-internal/read-graph";

const sessionEvidence = machineSessionSchema
  .unwrap()
  .pick({ row: true, whose: true })
  .extend({
    attachment: z.object({ session: z.string() }).nullable(),
  });
const machineEvidence = z.object({
  revit: machineSchema
    .unwrap()
    .shape.revit.unwrap()
    .pick({ years: true })
    .extend({
      sessions: z.array(sessionEvidence).nullable(),
    }),
  legs: z.object({ years: machineLegSchema.optional(), sessions: machineLegSchema.optional() }),
});
const publishedMachine = z.object({ machine: machineEvidence });
const sessionKey = ({ row, whose, attachment }: z.infer<typeof sessionEvidence>) => {
  const process =
    row.case === "controlled-pending" && row.attempt.attempt === "launched"
      ? row.attempt.process
      : "process" in row
        ? row.process
        : null;
  return canonicalRouteInput([
    row.case,
    "id" in row ? row.id : null,
    row.year,
    process,
    row.execution,
    whose,
    "bridge" in row ? row.bridge.bridge : null,
    row.case === "controlled-active" && row.bridge.bridge === "ready" && row.bridge.unresponsive,
    attachment?.session ?? null,
  ]);
};
// Follow changes people can act on, without invalidating for SDK sampling time or bridge ticks.
const machineKey = ({ revit, legs }: z.infer<typeof machineEvidence>) =>
  canonicalRouteInput([
    revit.years?.slice().sort((a, b) => a - b) ?? null,
    legs.years?.error != null,
    keptMachineLegAt(legs.years),
    revit.sessions?.map(sessionKey).sort() ?? null,
    legs.sessions?.observedAtUtc != null,
    legs.sessions?.error ?? null,
  ]);

export function readInvalidations(
  workspace: RouteWorkspace,
  marks: HostMarks,
  recorded: boolean,
  publications: Publications,
  subscribeFiles?: (changed: (name: string) => void) => () => void,
  /** Action receipts: a landed Revit write moves the Timeline's barrier without a Work event. */
  subscribeReceipts?: (changed: () => void) => () => void,
) {
  const revisions = new Map<string, number>();
  const revision = (name: string, args: unknown) =>
    revisions.get(canonicalRouteInput([name, args])) ?? 0;
  const changed = (matches: (name: string, args: unknown) => boolean) => {
    for (const [key, value] of revisions) {
      const [name, args] = JSON.parse(key);
      if (matches(name, args)) revisions.set(key, value + 1);
    }
    publications.invalidate((trace) => matches(trace.name, trace.args));
  };
  // One persisted Work has many spellings: `from` is carry-over provenance and the address may be
  // spelled differently. Dependency identity is `workKey()`, the same identity the Work feed uses (D36).
  // Every traced and written scope is already a decoded WorkKey, so a malformed one is a bug: throw.
  const identity = (scope: unknown) => workKey(workKeySchema.parse(scope));
  const workMatches = (args: unknown, owner: string, scope: unknown) => {
    const input = workInput.input.safeParse(args);
    return (
      input.success && input.data.owner === owner && identity(input.data.scope) === identity(scope)
    );
  };
  let stopWork = () => {},
    stopMarks = () => {};
  let watchingWork = false,
    watchingMarks = false;
  const seenMarks = new Map<string, string>();
  const observeMarks = () => {
    if (recorded) return;
    for (const [key, previous] of seenMarks) {
      const ref = JSON.parse(key),
        next = canonicalRouteInput([
          marks.observedSince,
          marks.changedAt(ref),
          marks.generation?.(ref),
        ]);
      if (next !== previous) {
        seenMarks.set(key, next);
        changed((name, args) => name === "document-mark" && canonicalRouteInput(args) === key);
      }
    }
  };
  const readRevision = (name: string, args: unknown) => {
    if ((name === "work" || name === "work-timeline") && !watchingWork) {
      watchingWork = true;
      // ponytail: any Work write moves every Timeline input; match its Works if that proves noisy.
      const stopWrites = workspace.subscribeUncaptured((event) =>
        changed(
          (name, args) =>
            name === "work-timeline" ||
            (name === "work" && workMatches(args, event.route, event.scope)),
        ),
      );
      const stopReceipts = recorded
        ? undefined
        : subscribeReceipts?.(() => changed((name) => name === "work-timeline"));
      stopWork = () => {
        stopWrites();
        stopReceipts?.();
      };
    }
    if (name === "document-mark" && !recorded && !watchingMarks) {
      watchingMarks = true;
      stopMarks = marks.subscribe(observeMarks);
    }
    const key = canonicalRouteInput([name, args]);
    if (!revisions.has(key)) revisions.set(key, 0);
    if (name === "document-mark" && !recorded) {
      const ref = documentRefSchema.parse(args),
        key = canonicalRouteInput(ref);
      if (!seenMarks.has(key))
        seenMarks.set(
          key,
          canonicalRouteInput([marks.observedSince, marks.changedAt(ref), marks.generation?.(ref)]),
        );
    }
    return revision(name, args);
  };
  const stopFiles = recorded
    ? undefined
    : subscribeFiles?.((name) =>
        changed(
          (input) =>
            input === `file:${name}` ||
            (`file:${name}` === settingsFile.name && input === "work-timeline"),
        ),
      );
  const stopPlaces = recorded
    ? undefined
    : subscribePlaces(() => changed((name) => name === "places"));
  const observePublication = (
    subscription: string,
    generation: number,
    publish: (publication: Publication<unknown>) => void,
    machineRead: { recipe: string; observe: ResourceObserver },
  ) => {
    let published: string | undefined, observed: string | undefined;
    let stopMachine: (() => void) | undefined;
    const compare = () => {
      const current = publications.publication(subscription);
      if (
        published !== undefined &&
        observed !== undefined &&
        published !== observed &&
        current?.generation === generation &&
        current.state === "current"
      )
        publications.invalidate((trace) => trace.name === machineRead.recipe, subscription);
    };
    const stop = publications.observe(subscription, (publication) => {
      if (publication.generation !== generation) return;
      publish(publication);
      if (recorded || publication.state !== "current") return;
      // Keep the existing machine poll observed for the lifetime of the subscription.
      const data = publication.value?.trace.some((trace) => trace.name === machineRead.recipe)
        ? publishedMachine.safeParse(publication.value.data)
        : undefined;
      published = data?.success ? machineKey(data.data.machine) : undefined;
      if (published !== undefined)
        stopMachine ??= machineRead.observe({ kind: "machine" }, (frame) => {
          if (frame.kind !== "snapshot") return;
          const evidence = machineEvidence.safeParse(frame.value);
          if (evidence.success) observed = machineKey(evidence.data);
          compare();
        });
      // The poll can get ahead of an in-flight read.
      compare();
    });
    return () => {
      stopMachine?.();
      stop();
    };
  };
  return {
    revision: readRevision,
    observePublication,
    close: () => {
      stopFiles?.();
      stopPlaces?.();
      stopWork();
      stopMarks();
    },
  };
}
