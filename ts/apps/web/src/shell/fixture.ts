import { legacyVerbEnvironment } from "./legacy-environment-bridge";
import { createFixtureHost } from "../../../../packages/host-contracts/src/fixture-host";
import {
  routeSettingsSnapshotSchema,
  address,
  applyPatches,
  bindWork,
  routeDocDelta,
  workKey,
  type RouteGraph,
  type GraphSeedData,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { createGraphMount, type MountAdapters, type MountScope } from "./mount-owner";
import type { ReadingSource } from "./readings";
import { createSettingsOwner, settingFields } from "./settings";
import type { WorkScopePorts } from "./use-work-scope";

export { fixtureName, currentFixture } from "./fixture-lane";

interface FixtureMountEnvironment<P, W> {
  graph: RouteGraph<P, W>;
  ports: WorkScopePorts<W>;
  adapters: MountAdapters<P, W>;
}

export async function fixtureEnvironment<P, W>(
  graph: RouteGraph<P, W>,
  name: string,
): Promise<FixtureMountEnvironment<P, W>> {
  // Companion chat must not borrow another route's seed or block its editor as a running Pea.
  if (
    typeof location !== "undefined" &&
    location.pathname !== graph.directory?.path &&
    graph.seeds?.attach
  )
    name = "attach";
  const declaration = graph.seeds?.[name];
  if (!declaration)
    return pendingFixtureEnvironment(
      graph,
      name,
      `Fixture '${name}' is not declared by ${graph.name}`,
    );
  try {
    return pendingFixtureEnvironment(graph, name, null, await declaration.load());
  } catch (error) {
    return pendingFixtureEnvironment(
      graph,
      name,
      `Fixture '${name}' failed to load: ${String(error)}`,
    );
  }
}

export function pendingFixtureEnvironment<P, W>(
  graph: RouteGraph<P, W>,
  name: string,
  failure: string | null = "Loading fixture…",
  seed?: GraphSeedData<P, W>,
): FixtureMountEnvironment<P, W> {
  // Isolate the journal by route namespace; Work subject bytes retain their domain meaning.
  const fixtureId = crypto.randomUUID();
  const isolatedAddress = address(`C:/Fixtures/${fixtureId}.rvt`);
  let key = bindWork(`${graph.key}.${fixtureId}`, isolatedAddress, name);
  const target =
    seed?.target ??
    (graph.needs
      ? { kind: "document" as const, ref: { session: "fixture", openId: graph.key } }
      : { kind: "host" as const });
  let snapshot: MountScope<W> = { target, work: null, workKey: key, failure };
  const stored = new Map<string, MountScope<W>>();
  const listeners = new Set<() => void>();
  const accepted = new Set<{ key: string; notify(ack: WorkWriteAck): void }>();
  const select = (page: P) => {
    const subject = graph.workSubject ? String(page[graph.workSubject] || name) : name;
    const nextKey = bindWork(`${graph.key}.${fixtureId}`, isolatedAddress, subject);
    const id = workKey(nextKey);
    if (stored.has(id) && workKey(key) === id) return;
    key = nextKey;
    let next = stored.get(id);
    if (!next) {
      const parsed = graph.work?.safeParse(seed?.works?.[subject] ?? seed?.work ?? {});
      next = {
        target,
        workKey: key,
        failure:
          failure ?? (parsed && !parsed.success ? `Fixture Work: ${parsed.error.message}` : null),
        work: parsed?.success
          ? { handle: { key, revision: 0 }, doc: structuredClone(parsed.data) }
          : null,
      };
      stored.set(id, next);
    }
    snapshot = next;
    for (const notify of listeners) notify();
  };
  select((seed?.page ?? {}) as P);
  const refuse = (error: string) => ({
    ok: false as const,
    kind: "refused" as const,
    error,
    hint: "Choose a declared fixture seed",
  });
  const ports: WorkScopePorts<W> = {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    async write(requestKey, request) {
      if (!graph.work || !snapshot.work || snapshot.failure || workKey(requestKey) !== workKey(key))
        return refuse(snapshot.failure ?? "Fixture Work is unavailable");
      const before = snapshot.work.doc;
      const result = applyPatches(
        { route: graph.key, title: graph.name, description: graph.name, schema: graph.work },
        { version: 1, revision: snapshot.work.handle.revision, doc: before },
        "human",
        request.patches,
        request.expectedRevision,
        false,
        request.kind === "restore",
      );
      if (!result.ok) return result;
      const { doc, revision } = result.envelope;
      const ack: WorkWriteAck = {
        key,
        kind: request.kind,
        by: "human",
        press: request.press,
        base: request.expectedRevision,
        revision,
        patches: routeDocDelta(before, doc),
        inverse: routeDocDelta(doc, before),
        undoable: true,
        ...(request.kind === "restore" ? { restoreOf: request.restoreOf } : {}),
      };
      snapshot = { ...snapshot, work: { handle: { key, revision }, doc } };
      stored.set(workKey(key), snapshot);
      for (const notify of listeners) notify();
      for (const entry of accepted) if (entry.key === workKey(ack.key)) entry.notify(ack);
      return { ok: true, revision, write: ack };
    },
    startFresh: async () => refuse("Fixture Work is already in memory"),
    reread() {},
    subscribeAcceptedDeltas(key, notify) {
      const entry = { key: workKey(key), notify };
      accepted.add(entry);
      return () => {
        accepted.delete(entry);
      };
    },
    status: {
      resolution: { kind: "resolved", target },
      bindingLost: null,
      targetProvenance: { source: "seed" },
      closed: false,
      unreadable: false,
      failure,
    },
  };
  // Derived Reading examples use the graph catalog; native HTTP examples use producer schemas.
  const examples = createFixtureHost(
    Object.keys(graph.readings).map((key) => ({ key, effect: "Read" })),
    Object.fromEntries(
      Object.entries(seed?.readings ?? {}).filter(([key]) => Object.hasOwn(graph.readings, key)),
    ),
  );
  const sources: Record<string, ReadingSource> = {};
  for (const [id, reading] of Object.entries(graph.readings)) {
    const value = (context: { page: unknown; work?: unknown }) =>
      examples.read(id, context.page, context.work);
    const source = id;
    switch (reading.kind) {
      case "derive":
        sources[source] = {
          kind: "derive",
          key: (scope) => [scope.page, scope.workRevision],
          derive: value,
        };
        break;
      case "worker":
        sources[source] = {
          kind: "worker",
          algorithmVersion: "fixture",
          connect: () => ({
            update: (context, deliver) =>
              deliver({ kind: "complete", value: value(context), revision: 0 }),
            stop() {},
          }),
        };
        break;
      case "port":
        sources[source] = {
          kind: "port",
          open: (context) => ({ value: value(context), close() {} }),
        };
        break;
      default:
        sources[source] = {
          kind: reading.kind,
          // A seed reading of Work (ducts `sheet`) must reopen on an edit, as the host's does.
          key: (scope) => scope.workRevision,
          open: (context, deliver) =>
            deliver({ kind: "complete", value: value(context), revision: 0 }),
        };
    }
  }
  let settings = routeSettingsSnapshotSchema.parse({ revision: 0, values: {} });
  const localSettings = createSettingsOwner(settingFields(graph), {
    read: async () => settings,
    write: async (patch) =>
      (settings = routeSettingsSnapshotSchema.parse({
        revision: settings.revision + 1,
        values: { ...settings.values, ...patch },
      })),
    subscribe: () => () => {},
  });
  return {
    graph,
    ports,
    adapters: {
      ...ports,
      sources: Object.fromEntries(
        Object.entries(graph.readings).map(([id, reading]) => [reading.source, sources[id]!]),
      ),
      readingSources: sources,
      settings: localSettings,
      legacyEnvironment: legacyVerbEnvironment(seed?.queries ?? {}, name),
      selectPage: select,
      initialPage: seed?.page,
      subscribeReceipts: undefined,
      subscribeDocumentChanged: undefined,
      checkpoint: undefined,
      logReading: undefined,
    } satisfies Partial<MountAdapters<P, W>>,
  };
}

/** The same owner used by the browser, convenient for deterministic route proofs. */
export async function createFixtureMount<P, W>(
  graph: RouteGraph<P, W>,
  name: string,
  adapters: Partial<MountAdapters<P, W>> = {},
  initial: Partial<P> = {},
) {
  const lane = await fixtureEnvironment(graph, name);
  return createGraphMount(lane.graph, { ...adapters, ...lane.adapters }, initial);
}
