/**
 * `useRoute(manifest)` — the one owner. It replaces `state/route-store.ts`, `state/registry.ts`,
 * `state/use-route-store.ts` and `targeting/actions.ts`: a route hands it a manifest and gets back
 * a resolution, its Work, its Readings, its Page, and one handle per action. Public handles return
 * structured Refusals (`route/refusal.ts`).
 */
import * as Atom from "effect/unstable/reactivity/Atom";
import { frozenDemo } from "#/host/demo-client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  UNREADABLE_WORK,
  bindWork,
  type Address,
  type Reading,
  type ReadingRequest,
  type RouteStatePatch,
  type TargetResolution,
  type WorkKey,
} from "@pe/agent-contracts";
import {
  changedInRevit,
  dirty,
  readingAtom,
  peReadings,
  previousOf,
  targetInventory,
} from "#/readings";
import { DEFAULT_WAIT_S, type RouteManifest } from "./manifest";
import { callHostDynamic } from "#/host/client";
import { causeRefusal, refuse, type Refusal } from "./refusal";
import { useThreadScope } from "#/chat/scope";
import {
  ActionRefusal,
  type LogEntry,
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
import { useRouteTarget, type BindingLost } from "./route-target";

export interface ActionHandle {
  readonly label: string;
  readonly says: string;
  readonly chord?: string;
  /** The manifest's `ready()` sentence; null = runnable. */
  readonly refusal: string | null;
  readonly stage?: string;
  /** Page state the verb carries ("Partition 10"); null = none. */
  readonly count: number | null;
  readonly run: (input?: unknown) => Promise<Refusal | null>;
}

/** What the last run of an action left behind: the action, and its refusal or nothing. */
interface RouteOutcome<A extends string> {
  readonly key: A;
  readonly label: string;
  readonly refusal: Refusal | null;
  /** The wait was stopped from the flag; the host call itself was not cancelled. */
  readonly stopped: boolean;
  /** When it landed; a flag dismissed once stays dismissed for this outcome. */
  readonly at: number;
}

export interface RouteHandle<W, R extends string, P, A extends string> {
  readonly manifest: RouteManifest<W, R, P, A>;
  readonly resolution: TargetResolution;
  /** The `?target` pin: a view over one document, never written by the route; null reads the head. */
  readonly chosen: string | null;
  /** The thread head, the one target store; null on a route that names no thread. */
  readonly head: {
    readonly thread: string;
    /** Move the thread's target; the head refuses when stale or while a turn holds it. */
    readonly set: ReturnType<typeof useThreadScope>["set"];
    readonly refusal: string | null;
  } | null;
  readonly work: {
    readonly key: WorkKey;
    /** Addressless: this Work belongs to one unsaved document's lifetime and dies with it. */
    readonly ephemeral: boolean;
    readonly doc: W | null;
    readonly revision: number | null;
    /** Whether the authoritative Work reading is current, including a current absent document. */
    readonly current: boolean;
    /** Revit changed the Work's document after the read its staged rungs rest on (`takenAt`). */
    readonly changed: boolean;
    /** `expectedRevision` binds the write; `null` binds it to nothing rendered and refuses. */
    readonly write: (
      patches: RouteStatePatch[],
      expectedRevision?: number | null,
    ) => Promise<Refusal | null>;
    /** Another writer landed first; the last write was refused. `reload` reads Work again. */
    readonly conflict: boolean;
    /** The owner's own sentence when Work cannot be read (e.g. saved in an older shape). */
    readonly refusal: string | null;
    /**
     * Human-only: sets the unreadable Work aside, untouched, and starts an empty Work. A refusal
     * lands on `failure`; success re-reads Work. Null unless the failure is the host's UNREADABLE_WORK.
     */
    readonly startFresh: (() => Promise<Refusal | null>) | null;
    /**
     * Human-only, read-only: what the route's declared `salvage` carries over from Work it can no
     * longer read (the unreadable Work, else the newest aside). Null when there is none.
     */
    readonly salvage: (() => Promise<{ from: string; value: unknown } | null>) | null;
    readonly reload: () => void;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  /** The bridge inventory the resolution reads; a seed's `inventory` reading when seeded. */
  readonly inventory: Reading<unknown>;
  /**
   * The exact document this route was bound to (session › openId) is gone from the live
   * inventory. Its sentence is every verb's refusal; `reopened` is the same title open under a
   * new openId in that session, offered first and never taken for the person (F-X-1).
   */
  readonly bindingLost: BindingLost | null;
  readonly page: readonly [P, (next: Partial<P>) => void];
  readonly actions: Readonly<Record<A, ActionHandle>>;
  readonly busy: { readonly key: A; readonly seconds: number } | null;
  /** Stop waiting on the busy action (its flag's stop). */
  readonly stop: () => void;
  readonly failure: Refusal | null;
  readonly outcome: RouteOutcome<A> | null;
  /** The page log, newest first. */
  readonly log: readonly LogEntry[];
  readonly demo: boolean;
  /** Re-acquire these Readings, as a verb's `dirties` would; a pane's focus edge calls it. */
  revalidate(keys: readonly R[]): void;
}

export function useRoute<W, R extends string, P, A extends string>(
  manifest: RouteManifest<W, R, P, A>,
  options: {
    target?: string | null | ((page: P) => string | null);
    work?: string | ((page: P, target: Address | null) => string | undefined);
    page?: Partial<P>;
    provided?: Partial<Record<R, Reading<unknown>>>;
    /** The thread whose head is this route's default target. */
    thread?: string;
  } = {},
): RouteHandle<W, R, P, A> {
  const demo = useMemo(frozenDemo, []);
  const seed = demo ? manifest.seeds?.[demo as A] : undefined;
  const owner = useRouteOwner(() =>
    createRouteOwner(
      manifest.key,
      seed ? makeAtomRegistry({ defaultIdleTTL: 400 }) : appAtomRegistry,
    ),
  );
  const [page, setPageState] = useState<P>(() => {
    const initial = { ...seed?.page, ...options.page };
    return manifest.page ? manifest.page.parse(initial) : (initial as P);
  });
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
  const { inventoryResult, head, resolution, bindingLost, bindingLostRef, resolvedAddress } =
    useRouteTarget(manifest, owner.registry, seed, target, options.thread);
  const work =
    typeof requestedWork === "function" ? requestedWork(page, resolvedAddress) : requestedWork;
  const boundDocument =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const boundRef = JSON.stringify(boundDocument);
  // An unsaved document has no Address, so its Work keys by the one lifetime it belongs to. The
  // ref rides along once the Address exists too, so the host carries that Work over on Save As.
  const key: WorkKey = useMemo(
    () => bindWork(manifest.key, resolvedAddress, work, boundDocument ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundDocument is identified by boundRef
    [manifest.key, resolvedAddress, work, boundRef],
  );
  /** An unsaved document's Work: keyed by this lifetime, and gone when it ends. */
  const ephemeral = key.binding === "open";
  // A target-owned Work declaration cannot fall back to the shared `route/target:` key while its
  // Address is unresolved. Host/file Work and explicit named workspaces intentionally use null.
  const workNeedsTarget = (
    Object.values(manifest.actions ?? {}) as NonNullable<typeof manifest.actions>[A][]
  ).some((action) => action.requires?.work && action.needs !== "host");
  const canReadWork =
    seed || work !== undefined || resolvedAddress !== null || ephemeral || !workNeedsTarget;
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
  }, [resolvedReadingSpecs, boundKey]);
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

  const writer = useMemo(
    () => (spec && slice ? docWriter(spec, key, owner.registry, slice, owner.conflict) : null),
    [spec, slice, key, owner],
  );
  // Authored patches queue so two same-tick edits carry the first accepted revision into the
  // second write. An explicit revision remains the caller's conflict boundary, rebased only over
  // this owner's own landed writes: `own` maps each landed write's base to its result, and a bound
  // write follows that chain, so a revision rendered before the owner's own writes landed still
  // binds while any foreign write breaks the chain and refuses truthfully. `null` is a bound write
  // with nothing rendered to bind to.
  const writeWork = useMemo(() => {
    let queue: Promise<void> = Promise.resolve();
    let queued = 0;
    let landed: number | null = null;
    const own = new Map<number, number>();
    return (
      patches: RouteStatePatch[],
      expectedRevision?: number | null,
    ): Promise<Refusal | null> => {
      queued += 1;
      let accepted: { base: number; revision: number } | undefined;
      const result = queue
        .then(async () => {
          if (seed) return refuse("not-ready", "frozen seed is read-only");
          if (expectedRevision === null)
            return refuse("not-ready", "Work has not been read yet; nothing on screen to act on");
          // An unresolved target is the reason, never "not hydrated" (F-X-1 item 1).
          if (!writer) {
            const lost = bindingLostRef.current;
            return lost ? refuse("no-target", lost.sentence) : notHydrated;
          }
          let bound = expectedRevision;
          if (bound !== undefined) while (own.has(bound)) bound = own.get(bound)!;
          return writer.apply(patches, bound ?? landed ?? undefined, (base, revision) => {
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
            landed = accepted.revision;
          }
          if (refusal) owner.registry.set(owner.failure, refusal);
          queued -= 1;
          if (queued === 0) landed = null;
          return refusal;
        });
      queue = result.then(() => undefined);
      return result;
    };
  }, [writer, owner, seed]);
  // Stable: it is `page[1]`, `ctx.setPage`, and a dep of consumer memos (families/store.ts).
  const pageEpoch = useRef(0);
  const setPage = useCallback((next: Partial<P>) => {
    pageEpoch.current += 1;
    setPageState((current) => ({ ...current, ...next }));
  }, []);
  const scopeKey = JSON.stringify([boundKey, key]);
  const actionScope = useMemo(() => ({}), [scopeKey]);
  const currentActionScope = useRef(actionScope);
  currentActionScope.current = actionScope;

  const stage = (page as { stage?: unknown }).stage;
  usePageLogNotes(owner, {
    target: boundKey,
    stage: manifest.stages?.find((item) => item.key === stage)?.word,
    revision: doc?.revision ?? null,
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
      const target = targetRefusal(action.needs);
      if (target) return target;
      // Read and absent is a state of the world, not a loading one: say it (F-X-2). The first
      // authored write (a selection, a staged cell) initializes the Work.
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
    const actionPageEpoch = pageEpoch.current;
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
      call: (operation: string, input?: unknown) =>
        callHostDynamic(operation, input, targetHeaders(ctx.target)),
      // Bound to the action's snapshot, through the queue: it follows this owner's own landed
      // writes past that snapshot, and a foreign write still refuses it.
      write: async (patches: RouteStatePatch[]) => {
        const refusal =
          actionRevision === null ? notHydrated : await writeWork(patches, actionRevision);
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
      setPage: (next: Partial<P>, guard?: readonly (keyof P)[]) => {
        if (currentActionScope.current !== actionScope) return;
        setPageState((current) => {
          const currentPage = current as Record<keyof P, unknown>;
          const actionPage = page as Record<keyof P, unknown>;
          if (
            guard
              ? guard.some((field) => !Object.is(currentPage[field], actionPage[field]))
              : pageEpoch.current !== actionPageEpoch
          )
            return current;
          return { ...current, ...next };
        });
      },
    };
    return Object.fromEntries(
      Object.entries(manifest.actions ?? {}).map((entry) => {
        const name = entry[0] as A;
        const action = entry[1] as NonNullable<typeof manifest.actions>[A];
        const health = requirementRefusal(action);
        const handle: ActionHandle = {
          label: action.label,
          says: action.saysNow?.(ctx as never) ?? action.says,
          ...(typeof action.chord === "string" ? { chord: action.chord } : {}),
          ...(action.stage ? { stage: action.stage } : {}),
          count: health ? null : (action.count?.(ctx as never) ?? null),
          refusal: health ?? action.ready(ctx as never, undefined as never),
          run: async (input?: unknown) => {
            let stopped = false;
            const refusal = await owner.runAction(
              name,
              async () => {
                const target = targetRefusal(action.needs);
                if (target) return refuse("no-target", target);
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
                const refusal = (await action.run(ctx as never, parsed.data as never)) ?? null;
                // A partial outcome landed something: what it dirties is stale either way.
                if (!refusal || refusal.code === "partial")
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
              const refusal = await writer.startFresh();
              if (refusal) owner.registry.set(owner.failure, refusal);
              else dirty({ ...key, kind: "work" });
              return refusal;
            }
          : null,
      salvage: writer && !seed ? () => writer.salvage() : null,
      reload: () => {
        if (seed) return;
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
    ],
  );

  return {
    manifest,
    resolution,
    chosen: target,
    head,
    work: workHandle,
    readings,
    inventory: seededReadings ? (seededReadings.inventory ?? { state: "absent" }) : inventoryResult,
    bindingLost,
    page: [page, setPage] as const,
    actions,
    busy,
    stop: owner.stop,
    failure,
    outcome,
    log,
    demo: seed !== undefined,
    revalidate: (keys) => {
      for (const [name, , request] of readingAtoms)
        if (keys.includes(name as R)) owner.write(name, `dirty/${name}`, () => dirty(request));
    },
  };
}
