import { z } from "zod";
import {
  type ExecutionTarget,
  type WorkHandle,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
  type RouteStateWriteResult,
  type WorkJournalDoor,
  type RouteFingerprint,
} from "@pe/agent-contracts";
import { mountTypedRoute, type TypedMount } from "./typed-mount";
import type { TypedRoute } from "../route/typed-route";
import type { Publication } from "../route/host-read";
import { appAtomRegistry } from "./owner";
import { completion, workOutcome, failedWrite } from "./work-door-observation";

/** External-store test ports. Work stays owned by the supplied store, never copied into a second writer. */
export interface MountScope<W> {
  target: ExecutionTarget;
  work: { handle: WorkHandle; doc: W } | null;
}
export interface ExternalMountPorts<W> {
  getSnapshot(): MountScope<W>;
  subscribe(notify: () => void): () => void;
  write(key: WorkKey, write: WorkWrite): Promise<RouteStateWriteResult>;
  subscribeAcceptedDeltas(key: WorkKey, accept: (ack: WorkWriteAck) => void): () => void;
  sources: Readonly<Record<string, (scope: MountScope<W>) => Promise<Publication>>>;
  binding?: unknown;
  cell?: unknown;
}
export interface WitnessRoute<P> {
  module: TypedRoute;
  page: z.ZodType<P>;
  fingerprint: RouteFingerprint;
  staleMessage: string;
}

/** Typed mount over an externally owned test store. No graph admission or browser read scheduler. */
export function createGraphMount<P, W>(
  route: WitnessRoute<P>,
  ports: ExternalMountPorts<W>,
  initial: Partial<P> = {},
) {
  let active = true;
  let search = new URLSearchParams();
  const addressListeners = new Set<() => void>();
  const work: WorkJournalDoor = {
    lifetime: "subscription",
    open(scope) {
      return {
        subscribe(deliver) {
          const receive = () => {
            const current = ports.getSnapshot().work;
            if (!current) {
              deliver({ kind: "absent" });
              return;
            }
            deliver({
              kind: "ready",
              snapshot: {
                handle: current.handle,
                revision: current.handle.revision,
                value: current.doc,
              },
              history: { acks: [], from: current.handle.revision + 1 },
            });
          };
          const stop = ports.subscribe(receive);
          const stopAcks = ports.subscribeAcceptedDeltas(scope.key, (ack) =>
            deliver({ kind: "ack", ack }),
          );
          receive();
          return () => {
            stopAcks();
            stop();
          };
        },
      };
    },
    submitWork(scope, request) {
      return completion(
        {
          kind: "pending",
        } as import("../../../../packages/agent-contracts/src/work-journal-door").WorkWriteOutcome,
        async () => {
          try {
            return workOutcome(await ports.write(scope.key, request));
          } catch (error) {
            return failedWrite(error);
          }
        },
      );
    },
    receipts() {
      return {
        subscribe(deliver) {
          // The external ports expose no native journal, and this witness cannot submit native actions.
          deliver({ kind: "ready", receipts: { rows: [], from: 0 as never, through: 0 as never } });
          return () => {};
        },
      };
    },
    submit() {
      throw Error("External Work witness cannot submit native actions");
    },
    accepted() {
      throw Error("External Work witness has no native receipts");
    },
  };
  const snapshot = ports.getSnapshot();
  const mount = mountTypedRoute(
    route.module,
    {
      address: {
        read: () => new URLSearchParams(search),
        write(value) {
          search = new URLSearchParams(value);
          addressListeners.forEach((f) => f());
        },
        subscribe(f) {
          addressListeners.add(f);
          return () => void addressListeners.delete(f);
        },
      },
      fixture: null,
      target: snapshot.target,
      work: {
        address: snapshot.work?.handle.key.target ?? null,
        open: snapshot.target.kind === "document" ? snapshot.target.ref : null,
      },
      custody: { current: () => active },
      memory: () => initial,
    },
    route.fingerprint,
    {
      work,
      sources: Object.fromEntries(
        Object.entries(ports.sources).map(([key, evaluate]) => [
          key,
          {
            kind: "use" as const,
            open(ctx, deliver) {
              let generation = 0;
              const refresh = async () => {
                const mine = ++generation;
                try {
                  const value = await evaluate(ports.getSnapshot());
                  if (!ctx.signal.aborted && mine === generation)
                    deliver({ kind: "complete", value, revision: value.version });
                } catch (error) {
                  if (!ctx.signal.aborted && mine === generation)
                    deliver({ kind: "failure", error });
                }
              };
              const stop = ports.subscribe(() => void refresh());
              void refresh();
              return () => {
                generation++;
                stop();
              };
            },
          } satisfies import("./source-contract").UseSource,
        ]),
      ),
    },
  );
  const context = () =>
    mount.draw(
      Object.keys(route.module.spec.panes)[0]!,
      (ctx) => ctx,
    ) as import("../route/typed-route").DrawContext<any, any, any, any>;
  return {
    typed: mount,
    snapshot: ports.getSnapshot,
    registry: appAtomRegistry,
    subscribe: mount.subscribe,
    version: mount.revision,
    view: {
      read: () => ({ page: route.page.parse(mount.page.read()) }),
      setPage(patch: Partial<P>) {
        return mount.move(patch);
      },
    },
    busy: () => null,
    control(
      id: string,
      input: { expectedRevision: number; patches: import("@pe/agent-contracts").RouteStatePatch[] },
    ) {
      return {
        run: async () => {
          if (id !== "edit") throw Error("External witness exposes only typed Work edits");
          if (ports.getSnapshot().work?.handle.revision !== input.expectedRevision)
            return { state: "refused" as const, refusal: { message: route.staleMessage } };
          const failure = await context().cells.patch(input.patches, { label: "Edit cells" });
          return failure
            ? { state: "refused" as const, refusal: { message: failure.message } }
            : { state: "done" as const, outcome: { state: "succeeded" as const } };
        },
      };
    },
    context,
    connect() {
      return () => {};
    },
    dispose() {
      active = false;
      mount.dispose();
    },
  };
}
export type ExternalTypedMount<P, W> = ReturnType<typeof createGraphMount<P, W>>;
export type { TypedMount };
