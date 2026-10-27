/**
 * `useRoute(manifest)` — the one owner. It replaces `state/route-store.ts`, `state/registry.ts`,
 * `state/use-route-store.ts` and `targeting/actions.ts`: a route hands it a manifest and gets back
 * a resolution, its Work, its Readings, its Page, and one handle per action. Public handles return
 * structured Refusals (`route/refusal.ts`).
 */
import * as Atom from "effect/unstable/reactivity/Atom";
import { useRouteCurrent, useRouteDemo } from "./activity";
import { useMemo, useRef, useState } from "react";
import {
  UNREADABLE_WORK,
  bindWork,
  type Address,
  type Reading,
  type ReadingRequest,
  type RouteStatePatch,
  type WorkKey,
} from "@pe/agent-contracts";
import {
  changedInRevit,
  dirty,
  inFlight,
  readingAtom,
  peReadings,
  previousOf,
  targetInventory,
} from "#/readings";
import { useWork } from "@pe/kit/lang/work";
import { situationCells } from "./cells";
import { DEFAULT_WAIT_S, type PageMove, type RouteManifest } from "./manifest";
import { urlPage, useInitialUrlPage, useUrlPage } from "./url";
import { createViewOwner } from "./view-owner";
import { actionFacts, staticNeed } from "./facts";
import { callHostRpc, type HostCallOptions } from "#/host/client";
import type { OpKey, OpCallArgs } from "@pe/host-contracts/operation-types";
import { causeRefusal, refuse, type Refusal } from "./refusal";
import {
  ActionRefusal,
  type Slice,
  appAtomRegistry,
  createRouteOwner,
  makeAtomRegistry,
  missingFields,
  targetHeaders,
  useOwned,
  usePageLogNotes,
  useRouteOwner,
} from "./route-owner";
import { docAtom, docWriter, notHydrated } from "./route-work";
import { useRouteTarget } from "./route-target";
import type { ActionHandle, RouteHandle, RouteOutcome } from "./handle";

const CLOSED_WORK = "its document is closed; this Work only reads";

export function useRoute<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
  options: {
    target?: string | null | ((page: P) => string | null);
    work?: string | ((page: P, target: Address | null) => string | undefined);
    page?: Partial<P>;
    provided?: Partial<Record<R, Reading<unknown>>>;
    /** The selected conversation: a view association for leases, never a target default. */
    thread?: string | null;
    /** False where the route does not own the address (a chat pane); a seed never does. */
    url?: boolean;
  } = {},
): RouteHandle<W, R, P, A> {
  const demo = useRouteDemo();
  const current = useRouteCurrent();
  const seed = demo ? manifest.seeds?.[demo as A] : undefined;
  const ownsUrl = options.url !== false && !seed;
  // The Page contract belongs to this owner. Changing action facts must not reconnect its URL
  // adapter: reconnecting restores the old address over an accepted move still waiting to flush.
  const url = useMemo(
    () => (ownsUrl ? urlPage(manifest) : null),
    [manifest.key, manifest.address, ownsUrl], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const urlInitial = useInitialUrlPage(url);
  const currentManifest = useRef(manifest);
  currentManifest.current = manifest;
  const owner = useRouteOwner(() => {
    const route = createRouteOwner(
      manifest.key,
      seed ? makeAtomRegistry({ defaultIdleTTL: 400 }) : appAtomRegistry,
    );
    const view = createViewOwner(
      route,
      manifest.page,
      { ...seed?.page, ...options.page, ...urlInitial },
      {
        address: manifest.address,
        transition: (page, patch, origin) =>
          currentManifest.current.transition?.(page, patch, origin) ?? { patch },
      },
    );
    return {
      ...route,
      view,
      dispose: () => {
        view.dispose();
        route.dispose();
      },
    };
  });
  const pageSnapshot = useOwned(owner.registry, owner.view.state)!;
  const page = pageSnapshot.page;
  const setPage = owner.view.setPage;
  useUrlPage(url, owner.view);
  const [outcome, setOutcome] = useState<RouteOutcome<A> | null>(null);
  // Busy and failure live in the OWNER, which is what `runAction` writes and what refuses a second
  // action. Holding a second copy in render state is how the button and the chord drifted apart:
  // the chord's refusal painted and the button's did not. One atom each, read here.
  const busy = useOwned(owner.registry, owner.busy) as { key: A; seconds: number } | null;
  const failure = useOwned(owner.registry, owner.failure);
  const log = useOwned(owner.registry, owner.log) ?? [];
  const { target: requestedTarget = null, work: requestedWork, provided } = options;
  const target = typeof requestedTarget === "function" ? requestedTarget(page) : requestedTarget;
  const spec = manifest.work;
  const conflictNow = useOwned(owner.registry, owner.conflict) ?? false;
  const {
    inventoryResult,
    resolution,
    bindingLost,
    bindingLostRef,
    resolvedAddress,
    workAddress,
    workOpen,
    targetProvenance,
  } = useRouteTarget(manifest, owner.registry, seed, target);
  // Readable Work whose document is not live (a known Address or exact open ref, no native
  // document): shown, never armed (no writer, no action, no native scope).
  const closedWork =
    !seed && ((workAddress !== null && resolvedAddress === null) || workOpen !== null);
  const work =
    typeof requestedWork === "function" ? requestedWork(page, workAddress) : requestedWork;
  const boundDocument =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const boundRef = JSON.stringify(boundDocument);
  // An unsaved document has no Address, so its Work keys by the one lifetime it belongs to. The
  // ref rides along once the Address exists too, so the host carries that Work over on Save As.
  const key: WorkKey = useMemo(
    () => bindWork(manifest.key, workAddress, work, boundDocument ?? workOpen ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are identified by their JSON
    [manifest.key, workAddress, work, boundRef, JSON.stringify(workOpen)],
  );
  /** An unsaved document's Work: keyed by its lifetime, and retained read-only once it closes. */
  const ephemeral = key.binding === "open";
  // A target-owned Work declaration cannot fall back to the shared `route/target:` key while its
  // Address is unresolved. Host/file Work and explicit named workspaces intentionally use null.
  const workNeedsTarget = (
    Object.values(manifest.actions ?? {}) as NonNullable<typeof manifest.actions>[A][]
  ).some((action) => action.requires?.work && staticNeed(action) !== "host");
  const canReadWork =
    seed || work !== undefined || workAddress !== null || ephemeral || !workNeedsTarget;
  const slice = useMemo(
    () => (!seed && spec && canReadWork ? docAtom(spec, key, peReadings) : null),
    [seed, spec, canReadWork, key],
  );
  const sliceResult = useOwned(owner.registry, slice);
  // A seed IS the Work in the demo lane; nothing is fetched and nothing is written through.
  // Memoized: `actions` and `work` key on this Slice, and a fresh wrapper per render walked down
  // to the Families `refreshReads` effect as "Maximum update depth exceeded".
  const doc: Slice<W> | null = useMemo(
    () =>
      seed
        ? { doc: seed.work as W, revision: 0 }
        : (((sliceResult ? previousOf(sliceResult) : undefined) as Slice<W> | undefined) ?? null),
    [seed, sliceResult],
  );
  const workCurrent = Boolean(seed || sliceResult?.state === "ready");

  // Every declared Reading is one subject on the one stream — EXCEPT in the demo lane, where the
  // seed is the whole observation and nothing is asked of the host. Subscribing anyway also
  // VALIDATED the request, and a manifest may only be able to name its subject once a Target is
  // bound (takeoff/actions.ts carries `{ session: "", openId: "" }` until then), so the demo
  // lane threw on mount before it could draw a single seeded row.
  // The live lane binds the resolved document into every placeholder target and leaves those
  // Readings `absent` until the route resolves — the same request is never sent unbound.
  const boundKey = JSON.stringify(boundDocument);
  const resolvedReadingSpecs = useMemo(
    () =>
      seed
        ? []
        : Object.entries(manifest.readings ?? {})
            .filter(([name]) => !Object.hasOwn(provided ?? {}, name))
            .map(
              ([name, reading]) =>
                [name, typeof reading === "function" ? reading(page, key) : reading] as const,
            ),
    [manifest.readings, page, seed, provided, key],
  );
  const readingSpecsKey = JSON.stringify(resolvedReadingSpecs);
  const readingAtoms = useMemo(() => {
    const bound = JSON.parse(boundKey) as { session: string; openId: string } | null;
    return resolvedReadingSpecs.flatMap(([name, request]) => {
      if (!request) return [];
      const r = request as ReadingRequest & { target?: { session?: string } };
      const placeholder = r.target !== undefined && r.target.session === "";
      if (placeholder && !bound) return [];
      const req = placeholder ? { ...r, target: bound } : r;
      return [
        [name, readingAtom(req as ReadingRequest, peReadings), req as ReadingRequest] as const,
      ];
    });
    // A Page move that names the same resources must not replace their aggregate subscription.
  }, [readingSpecsKey, boundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const readingsAtom = useMemo(
    () =>
      Atom.make((get) => ({
        ...Object.fromEntries(
          Object.keys(manifest.readings ?? {}).map((name) => [name, { state: "absent" }]),
        ),
        ...Object.fromEntries(readingAtoms.map(([name, atom]) => [name, get(atom)])),
      })).pipe(Atom.withLabel(`${manifest.key}/readings`), Atom.setIdleTTL(0)),
    [manifest.readings, readingAtoms],
  );
  const liveReadings = useOwned(owner.registry, readingsAtom) as Record<string, Reading<unknown>>;
  // Stable identities: consumers memoize on `readings` and `work`, and a fresh object per render
  // put the Families store's `refreshReads` effect into "Maximum update depth exceeded".
  const seededReadings = useMemo(
    () =>
      seed
        ? Object.fromEntries(
            Object.keys(manifest.readings ?? {}).map((name) => {
              const sown = seed.readings[name as R];
              return [
                name,
                sown === undefined
                  ? ({ state: "absent" } satisfies Reading<unknown>)
                  : ({ state: "ready", observation: sown } satisfies Reading<unknown>),
              ];
            }),
          )
        : null,
    [seed, manifest.readings],
  );
  const providedReadings = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(provided ?? {}).filter(([name]) =>
          Object.hasOwn(manifest.readings ?? {}, name),
        ),
      ),
    [manifest.readings, provided],
  );
  const readings = useMemo(
    () =>
      (seededReadings ?? { ...liveReadings, ...providedReadings }) as Record<R, Reading<unknown>>,
    [seededReadings, liveReadings, providedReadings],
  );
  // The route's readings and its running verb are its work, owned by the nearest work owner.
  const reading = Object.entries<Reading<unknown>>(readings)
    .filter(([, value]) => inFlight(value))
    .map(([name]) => name);
  useWork(reading.length > 0, `reading ${reading.join(", ")}…`);
  const running = busy ? manifest.actions?.[busy.key] : undefined;
  useWork(busy !== null, `${running?.label ?? "working"}…`);

  const writer = useMemo(
    () =>
      spec && slice && !closedWork
        ? docWriter(spec, key, owner.registry, slice, owner.conflict)
        : null,
    [spec, slice, key, owner, closedWork],
  );
  // Authored patches queue, and every write binds over ACKNOWLEDGED revisions: `own` maps each
  // landed write's base to its result, and a write follows that chain from its base. An explicit
  // revision is the caller's conflict boundary; an unbound write starts from the observed revision,
  // which can still trail this owner's own acknowledged write (the Reading re-reads after the ack).
  // Either way a revision from before the owner's own writes still binds, while any foreign write
  // breaks the chain and refuses truthfully. `null` is a bound write with nothing rendered to bind to.
  const writeWork = useMemo(() => {
    let queue: Promise<void> = Promise.resolve();
    const own = new Map<number, number>();
    return (
      patches: RouteStatePatch[],
      expectedRevision?: number | null,
      admitted = false,
    ): Promise<Refusal | null> => {
      // Hiding refuses new invocations. An admitted action still files its native result in Work.
      if (!admitted && !current())
        return Promise.resolve(refuse("not-ready", "This route tab is hidden"));
      let accepted: { base: number; revision: number } | undefined;
      const result = queue
        .then(async () => {
          if (seed) return refuse("not-ready", "frozen seed is read-only");
          if (expectedRevision === null)
            return refuse("not-ready", "Work has not been read yet; nothing on screen to act on");
          // An unresolved target is the reason, never "not hydrated" (F-X-1 item 1).
          if (!writer) {
            const lost = bindingLostRef.current;
            return lost
              ? refuse("no-target", lost.sentence)
              : closedWork
                ? refuse("no-target", CLOSED_WORK)
                : notHydrated;
          }
          const seen = slice && owner.registry.get(slice);
          // Unhydrated Work stays unbound: the writer refuses it as not hydrated.
          let bound =
            expectedRevision ??
            (seen?.state === "ready" ? (seen.observation.revision ?? 0) : undefined);
          if (bound !== undefined) while (own.has(bound)) bound = own.get(bound)!;
          return writer.apply(patches, bound, (base, revision) => {
            accepted = { base, revision };
          });
        })
        .catch(causeRefusal)
        .then((refusal) => {
          if (!refusal && accepted) {
            own.set(accepted.base, accepted.revision);
            // ponytail: bounded by count, not by observation. A caller can hold a revision rendered
            // before the owner's latest render, and an all-own chain back to it is still truthful;
            // a caller bound more than 256 own writes back refuses stale.
            if (own.size > 256) own.delete(own.keys().next().value!);
          }
          if (refusal) owner.registry.set(owner.failure, refusal);
          return refusal;
        });
      queue = result.then(() => undefined);
      return result;
    };
  }, [writer, slice, owner, seed, current, closedWork]);
  const scopeKey = JSON.stringify([boundKey, key]);
  const actionScope = useMemo(() => ({}), [scopeKey]);
  const currentActionScope = useRef(actionScope);
  currentActionScope.current = actionScope;

  const stage = (page as { stage?: unknown }).stage;
  usePageLogNotes(owner, {
    target: boundKey,
    stage: manifest.stages?.find((item) => item.key === stage)?.word,
    work: { slice: doc, segment: situationCells(manifest.cells)?.segment },
    lost: bindingLost,
  });

  const actions = useMemo(() => {
    const targetRefusal = (needs: NonNullable<typeof manifest.needs> | "host") => {
      if (needs === "host") return null;
      if (bindingLost) return bindingLost.sentence;
      if (resolution.kind !== "resolved")
        return resolution.kind === "checking" ? "checking the target" : `pick a ${needs}`;
      if (needs === "session") return resolution.target.kind === "host" ? "pick a session" : null;
      if (resolution.target.kind !== "document") return `pick a ${needs}`;
      if (needs === "document") return null;
      const resolved = resolution.target;
      const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);
      const found =
        inventory.kind === "ready" ? inventory.sessions[resolved.ref.session] : undefined;
      const document =
        found?.kind === "ready"
          ? found.values.find((item) => item.openId === resolved.ref.openId)
          : undefined;
      if (!document) return `pick a ${needs}`;
      return document.kind === (needs === "family" ? "family" : "project")
        ? null
        : `pick a ${needs}`;
    };
    const requirementRefusal = (action: NonNullable<typeof manifest.actions>[A]) => {
      if (seed) return "frozen seed is read-only";
      if (closedWork) return bindingLost?.sentence ?? CLOSED_WORK;
      const target = targetRefusal(actionFacts(action, ctx as never).needs);
      if (target) return target;
      // Read and absent is a state of the world, not a loading one: say it (F-X-2). The first
      // authored write (a selection, a edit cell) initializes the Work.
      if (action.requires?.work && workCurrent && doc?.doc === null)
        return "nothing authored here yet";
      if (action.requires?.work && (!doc || doc.doc === null))
        return "route document is not hydrated";
      if (action.requires?.work && !workCurrent) return "route document is not current";
      const missing = action.requires?.readings?.find((name) => readings[name].state !== "ready");
      return missing === undefined ? null : `${missing} is not ready`;
    };
    // An action's Work is one snapshot. Its late writes must let the host reject that snapshot,
    // not silently borrow a newer revision observed while the action was computing.
    const actionRevision = workCurrent ? (doc?.revision ?? 0) : null;
    const ctx = {
      target: resolution.kind === "resolved" ? resolution.target : ({ kind: "host" } as const),
      work: {
        key,
        doc: doc?.doc ?? null,
        revision: doc?.revision ?? null,
        refusal: sliceResult?.state === "failed" ? sliceResult.message : null,
      },
      readings,
      page,
      currentPage: () =>
        currentActionScope.current === actionScope ? owner.view.read().page : null,
      note: owner.verbNote,
      call: <K extends OpKey>(operation: K, ...[input]: OpCallArgs<K, never>) =>
        callHostRpc(
          operation,
          ...([input, targetHeaders(ctx.target)] as OpCallArgs<K, HostCallOptions>),
        ),
      // Bound to the action's snapshot, through the queue: it follows this owner's own landed
      // writes past that snapshot, and a foreign write still refuses it.
      write: async (patches: RouteStatePatch[], expectedRevision?: number) => {
        const refusal =
          actionRevision === null
            ? notHydrated
            : await writeWork(patches, expectedRevision ?? actionRevision, true);
        if (refusal) throw new ActionRefusal(refusal);
        return null;
      },
      command: async (name: string, input?: unknown) => {
        const refusal =
          writer && actionRevision !== null
            ? await writer.command(name as never, input, actionRevision)
            : notHydrated;
        if (refusal) throw new ActionRefusal(refusal);
        return null;
      },
      setPage: (next: Partial<P>, options?: PageMove<P> | readonly (keyof P)[]) => {
        if (currentActionScope.current !== actionScope) return;
        const move = (Array.isArray(options) ? { guard: options } : (options ?? {})) as PageMove<P>;
        const refusal = owner.view.move(next, move, "action", pageSnapshot);
        if (refusal) throw new ActionRefusal(refusal);
      },
    };
    return Object.fromEntries(
      Object.entries(manifest.actions ?? {}).map((entry) => {
        const name = entry[0] as A;
        const action = entry[1] as NonNullable<typeof manifest.actions>[A];
        const health = requirementRefusal(action);
        const facts = actionFacts(action, ctx as never);
        const handle: ActionHandle = {
          ...facts,
          label: action.labelNow?.(ctx as never) ?? action.label,
          says: action.saysNow?.(ctx as never) ?? facts.says,
          ...(typeof action.chord === "string" ? { chord: action.chord } : {}),
          ...(action.stage ? { stage: action.stage } : {}),
          count: health ? null : (action.count?.(ctx as never) ?? null),
          refusal: health ?? action.ready(ctx as never, undefined as never),
          run: async (input?: unknown) => {
            if (!current()) return refuse("not-ready", "This route tab is hidden");
            let stopped = false;
            const refusal = await owner.runAction(
              name,
              async (cancelWith) => {
                const unavailable = requirementRefusal(action);
                if (unavailable) return refuse("not-ready", unavailable);
                // The verb row runs a verb bare. An empty-object input is supplied; a verb that
                // needs an input it was not given refuses by name, not with a schema message.
                const given =
                  input === undefined &&
                  !action.input.safeParse(undefined).success &&
                  action.input.safeParse({}).success
                    ? {}
                    : input;
                const parsed = action.input.safeParse(given);
                if (!parsed.success)
                  return refuse(
                    "not-ready",
                    input === undefined
                      ? `${action.label} needs its input (${missingFields(action.input)}); run it from where it is chosen`
                      : (parsed.error.issues[0]?.message ?? "invalid input"),
                  );
                const reason = action.ready(ctx as never, parsed.data as never);
                if (reason) return refuse("not-ready", reason);
                const refusal =
                  (await action.run({ ...ctx, cancelWith } as never, parsed.data as never)) ?? null;
                // A partial outcome landed something: stale either way; a planning press, nothing.
                if (!action.plans?.(ctx as never) && (!refusal || refusal.code === "partial"))
                  for (const reading of action.dirties) {
                    const request = readingAtoms.find(([name]) => name === reading)?.[2];
                    if (request) owner.write(name, `dirty/${reading}`, () => dirty(request));
                  }
                return refusal;
              },
              undefined,
              () => {
                stopped = true;
              },
              action.label,
              action.waitSeconds ?? DEFAULT_WAIT_S,
            );
            setOutcome({ key: name, label: action.label, refusal, stopped, at: Date.now() });
            return refusal;
          },
        };
        return [name, handle];
      }),
    ) as Record<A, ActionHandle>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manifest,
    resolution,
    inventoryResult,
    readingAtoms,
    readings,
    page,
    pageSnapshot,
    doc,
    workCurrent,
    sliceResult,
    bindingLost,
    writer,
    writeWork,
    owner,
    seed,
    key,
    actionScope,
    current,
    closedWork,
  ]);

  const workHandle = useMemo(
    () => ({
      key,
      ephemeral,
      doc: (doc?.doc ?? null) as W | null,
      revision: doc?.revision ?? null,
      current: workCurrent,
      changed: sliceResult ? changedInRevit(sliceResult) : false,
      write: writeWork,
      conflict: conflictNow,
      refusal: sliceResult?.state === "failed" ? sliceResult.message : null,
      startFresh:
        sliceResult?.state === "failed" &&
        sliceResult.message === UNREADABLE_WORK &&
        writer &&
        !seed
          ? async () => {
              if (!current()) return refuse("not-ready", "This route tab is hidden");
              const refusal = await writer.startFresh();
              if (refusal) owner.registry.set(owner.failure, refusal);
              else dirty({ ...key, kind: "work" });
              return refusal;
            }
          : null,
      salvage: writer && !seed ? () => writer.salvage() : null,
      reload: () => {
        if (seed || !current()) return;
        owner.registry.set(owner.conflict, false);
        if (spec) dirty({ ...key, kind: "work" });
      },
    }),
    [
      key,
      ephemeral,
      doc,
      workCurrent,
      sliceResult,
      writer,
      writeWork,
      owner,
      conflictNow,
      spec,
      seed,
      current,
    ],
  );

  return {
    manifest,
    resolution,
    targetProvenance,
    chosen: target,
    thread: options.thread ?? null,
    work: workHandle,
    readings,
    inventory: seededReadings ? (seededReadings.inventory ?? { state: "absent" }) : inventoryResult,
    bindingLost,
    registry: owner.registry,
    pageState: owner.view.state,
    page: [page, setPage] as const,
    actions,
    busy,
    stop: owner.stop,
    failure,
    outcome,
    log,
    note: owner.verbNote,
    demo: seed !== undefined,
    revalidate: (keys) => {
      for (const [name, , request] of readingAtoms)
        if (keys.includes(name as R)) owner.write(name, `dirty/${name}`, () => dirty(request));
    },
  };
}
