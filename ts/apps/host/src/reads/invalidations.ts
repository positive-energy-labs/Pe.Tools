import { canonicalRouteInput, documentRefSchema } from "@pe/agent-contracts";
import { subscribePlaces } from "../places.ts";
import type { RouteWorkspace } from "@pe/runtime";
import type { HostMarks } from "../document-marks.ts";
import { workInput } from "./evaluator.ts";
import type { Publications } from "./publications.ts";

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
  const workMatches = (args: unknown, owner: string, scope: unknown) => {
    const input = workInput.input.safeParse(args);
    return (
      input.success &&
      input.data.owner === owner &&
      canonicalRouteInput(input.data.scope) === canonicalRouteInput(scope)
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
            name === "work-timeline" || (name === "work" && workMatches(args, event.route, event.scope)),
        ),
      );
      const stopReceipts = recorded ? undefined : subscribeReceipts?.(() => changed((name) => name === "work-timeline"));
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
    : subscribeFiles?.((name) => changed((input) => input === `file:${name}` || (name === "settings" && input === "work-timeline")));
  const stopPlaces = recorded ? undefined : subscribePlaces(() => changed((name) => name === "places"));
  return {
    revision: readRevision,
    close: () => {
      stopFiles?.();
      stopPlaces?.();
      stopWork();
      stopMarks();
    },
  };
}
