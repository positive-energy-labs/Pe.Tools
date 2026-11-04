import { legacyMountMetadata } from "./legacy-environment-bridge";
import type { RouteGraph } from "@pe/agent-contracts";
import { graphSettings } from "./settings";
import { mountRefusals, type MountAdapters } from "./mount-contracts";
import { createMountTarget } from "./mount-target-owner";
import { createMountPage } from "./mount-page-owner";
import { createMountReadings, type MountReadings } from "./mount-readings-owner";
import { createMountWork, type MountWork } from "./mount-work-owner";
import { createMountTimeline } from "./mount-timeline-owner";
import { createMountVerbs, type MountVerbs } from "./mount-verbs-owner";
export { graphFields, mountRefusals, CONFLICT_REFUSAL } from "./mount-contracts";
export type { MountAdapters, MountScope, MountBinding, BindingScope } from "./mount-contracts";
/** Composes noun owners and connects their subscriptions in publication order. */
export function createGraphMount<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  initial: Partial<P> = {},
) {
  if (adapters.environment && adapters.environment.route.data.key !== graph.key)
    throw Error("Environment admission does not belong to this route");
  const refusals = mountRefusals(graph, adapters);
  if (refusals.length) throw new Error(refusals.map((r) => `${r.path}: ${r.message}`).join("\n"));
  let readings: MountReadings<P, W> | undefined;
  let work: MountWork<P, W>;
  let verbs: MountVerbs<P, W>;
  const settings = adapters.settings ?? graphSettings(graph);
  const page = createMountPage(graph, adapters, initial, settings, () => readings?.states() ?? {});
  const target = createMountTarget(adapters);
  const history = createMountTimeline(adapters, target, {
    dispatch: (press) => verbs.dispatches.get(press),
    journal: (key) => work.journalFor(key),
    readings: () => readingOwner,
    verbs: () => verbs.verbs,
  });
  try {
    readings = createMountReadings(
      graph,
      adapters,
      page,
      settings,
      () => work?.scope ?? target.raw,
      history.timeline,
    );
  } catch (cause) {
    target.close();
    page.dispose();
    adapters.environment?.close();
    throw cause;
  }
  const readingOwner: MountReadings<P, W> = readings;
  work = createMountWork(graph, adapters, target, page, readingOwner, {
    snapshot: () => verbs.context.snapshot(),
    dispatch: (press) => verbs.dispatches.get(press),
  });
  const unTimeline = history.connect(work.journals);
  verbs = createMountVerbs(graph, adapters, target, page, readingOwner, work, history);
  let releases: (() => void)[] = [];
  const disconnect = () => {
    target.connected = false;
    for (const release of releases.splice(0).reverse()) release();
    work.disconnect();
  };
  return {
    ...verbs,
    ...legacyMountMetadata(adapters.legacyEnvironment),
    commandRefusal: adapters.environment
      ? adapters.environment.environment.nativeWrite
        ? null
        : "Native writes unavailable"
      : (adapters.legacyEnvironment?.commands.refusal ?? null),
    page: page.ports.page,
    controls: page.ports.controls,
    registry: page.registry,
    settings,
    view: page.view,
    readings: readingOwner,
    timeline: history.timeline,
    journals: work.journals,
    stage: page.stage,
    journal: work.journalFor,
    journalRefusal: work.journalRefusal,
    restore: work.restore,
    snapshot: () => work.scope,
    subscribe: target.subscribe,
    version: target.version,
    setAvailable: target.setAvailable,
    connect() {
      if (target.connected || target.disposed) return () => {};
      target.connected = true;
      const update = () => {
        if (target.update()) {
          verbs.cancelReviews();
          verbs.paneRows.clear();
          verbs.results.clear();
          work.present();
          const reset = Object.fromEntries(
            (graph.resetOnTarget ?? []).map((key) => [
              key,
              graph.fields[key].schema.parse(undefined),
            ]),
          );
          if (Object.keys(reset).length) page.view.setPage(reset as Partial<P>);
        }
        work.update();
        readingOwner.syncScope();
        target.notify();
      };
      work.connect();
      releases = [
        settings.connect(),
        settings.subscribe(() => {
          verbs.cancelReviews();
          readingOwner.syncScope();
          target.notify();
        }),
        adapters.subscribe(update),
        page.view.subscribe(() => {
          page.cleanSubject();
          adapters.selectPage?.(page.view.read().page);
          readingOwner.syncScope();
          target.notify();
        }),
        ...Object.keys(graph.readings).map((id) =>
          readingOwner.subscribe(id, () => {
            if (id === graph.subjectField?.roster) page.cleanSubject();
            work.completeHistory();
            target.notify();
          }),
        ),
      ];
      if (adapters.subscribeDocumentChanged)
        releases.push(
          adapters.subscribeDocumentChanged((ref) => readingOwner.documentChanged(ref)),
        );
      if (adapters.subscribeReceipts)
        releases.push(adapters.subscribeReceipts(history.acceptReceipt));
      update();
      page.cleanSubject();
      if (graph.subjectField) releases.push(readingOwner.mount([graph.subjectField.detail]));
      return disconnect;
    },
    dispose() {
      if (target.disposed) return;
      verbs.cancelReviews();
      target.close();
      disconnect();
      unTimeline();
      work.dispose();
      readingOwner.dispose();
      adapters.environment?.close();
      page.dispose();
      target.dispose();
    },
  };
}
export type GraphMount<P, W> = ReturnType<typeof createGraphMount<P, W>>;
