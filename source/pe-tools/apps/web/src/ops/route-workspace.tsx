import { useSearch } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Workspace } from "#/components/anatomy";
import { useAtomValue } from "@effect/atom-react";
import { FactChip } from "#/components/lang/chip";
import { RouteDocument } from "#/workbench/route-document";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { VerbLane } from "#/components/lang/verb-lane";
import { Provenance } from "#/components/lang/section";
import { Press } from "#/components/lang/press";
import { useFleet } from "#/host/fleet";
import { useHostOp } from "#/host/queries";
import { resolveTarget } from "#/host/target";
import { syntheticOps } from "#/ops/glance";
import { OPS_PRODUCT, opsRefusal, type OpsSlot } from "#/ops/product";
import { createOpsStore, type OpsStore } from "#/ops/store";
import { SyntheticRunner } from "#/ops/synthetic";
import { appAtomRegistry } from "#/state/registry";
import { useRouteStore } from "#/state/use-route-store";
import { pageScope } from "#/state/route-store";
import { TargetingHead } from "#/targeting/head";
import { useBindings, useRunner, type BindingState } from "#/targeting/kit";
import type { Feeds } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";
import { CapabilityCatalogSection } from "#/ops/capability-catalog";
import { OperationPane, parseSchema } from "#/ops/operation-pane";
import { buildFormRequest, readFormSeed } from "#/ops/schema-form";
import {
  createOpsFixtureSlice,
  OPS_FIXTURE_ADDRESS,
  OPS_FIXTURE_CAPABILITIES,
  OPS_FIXTURE_WORLD,
  OPS_FIXTURE_CATALOG,
  OPS_FIXTURE_REQUEST,
  OPS_FIXTURE_SELECTED,
  OPS_FIXTURE_SESSION,
  OPS_FIXTURE_TARGET,
  OPS_FIXTURE_WORLD_FACTS,
} from "#/ops/fixture";

export type HostOperationJsonSchema = Record<string, unknown>;

export function OpsRoute({ source }: { source?: "fixture" }) {
  return source === "fixture" ? (
    <FixtureOpsStoreOwner />
  ) : (
    <RouteDocument>{(at) => <OpsStoreOwner key={at} documentAddress={at} />}</RouteDocument>
  );
}

function FixtureOpsStoreOwner() {
  const store = useRouteStore(() => {
    const fixture = createOpsStore({
      registry: appAtomRegistry,
      scope: pageScope(OPS_FIXTURE_ADDRESS, OPS_FIXTURE_WORLD),
      slice: createOpsFixtureSlice(),
      apply: async () => ({ ok: true, revision: 1 }),
      call: async () => {
        throw new Error("fixture review refuses operation runs");
      },
      now: () => new Date("2026-08-30T18:42:00.000Z"),
      initial: {
        op: OPS_FIXTURE_SELECTED,
        identity: { target: OPS_FIXTURE_TARGET },
        request: {
          args: JSON.stringify(OPS_FIXTURE_REQUEST),
          mode: "form",
          formValues: OPS_FIXTURE_REQUEST,
        },
      },
    });
    return fixture;
  });
  return <OpsPage store={store} fixture />;
}

export function OpsStoreOwner({
  documentAddress,
}: {
  documentAddress: import("@pe/agent-contracts").Address;
}) {
  // ponytail: the page's world is its `?target`; owed: the ops route declares it in validateSearch.
  const target = useSearch({
    strict: false,
    select: (s) => (s as { target?: string }).target ?? "",
  });
  const store = useRouteStore(() =>
    createOpsStore({
      registry: appAtomRegistry,
      scope: pageScope(documentAddress, target),
    }),
  );
  return <OpsPage store={store} />;
}

export function OpsPage({ store, fixture = false }: { store: OpsStore; fixture?: boolean }) {
  const world = useAtomValue(store.atoms.world);
  const op = useAtomValue(store.atoms.op);
  const liveFleet = useFleet({ enabled: !fixture });
  const fleet = fixture
    ? {
        worlds: [OPS_FIXTURE_WORLD_FACTS],
        sessions: [OPS_FIXTURE_SESSION],
        isLoading: false,
        stale: false,
        error: null,
        at: Date.UTC(2026, 7, 30, 18, 42, 0),
        basis: ["fixture.ops.catalog", "fixture.route-document"],
      }
    : liveFleet;
  const resolution = resolveTarget(fleet.sessions, world);
  const session = resolution.kind === "resolved" ? resolution.session : null;
  const catalog = useHostOp("host.ops.catalog", undefined, {
    bridgeSessionId: session?.sessionId,
    enabled: !fixture && session !== null,
    staleTime: 60_000,
  });
  const operations = useMemo(
    () => (fixture ? OPS_FIXTURE_CATALOG : (catalog.data?.operations ?? [])),
    [catalog.data?.operations, fixture],
  );
  const selected = operations.find((operation) => operation.key === op);
  const requestSchema = selected ? parseSchema(selected.requestSchemaJson) : undefined;
  const args = useAtomValue(store.atoms.args);
  const mode = useAtomValue(store.atoms.mode);
  const formValues = useAtomValue(store.atoms.formValues);
  const picker = useAtomValue(store.atoms.picker);
  const selectedGlanceKey = useAtomValue(store.atoms.selectedGlance);
  const result = useAtomValue(store.atoms.result);
  const busyState = useAtomValue(store.atoms.busy);
  const hydrated = useAtomValue(store.atoms.hydrated);
  const selectedGlance = syntheticOps.find((glance) => glance.key === selectedGlanceKey);
  const currentIdentity = session
    ? {
        target: session.sdkSessionId ?? `pid:${session.processId}`,
      }
    : null;

  useEffect(() => {
    if (hydrated) void store.actions.syncBindings(world, op, currentIdentity);
  }, [hydrated, world, op, currentIdentity?.target, store]);
  useEffect(() => {
    const seed = selected?.requestExamples[0]?.json ?? selected?.safeDefaultRequestJson ?? "{}";
    store.actions.select(selected, readFormSeed(seed, requestSchema));
  }, [requestSchema, selected, store]);

  const feeds = useMemo<Feeds<OpsSlot>>(
    () => ({
      world: worldTrunk.feed(fleet),
      op: {
        options: operations.map((operation) => ({
          id: operation.key,
          label: operation.displayName ?? operation.key,
          sub: `${operation.intent} · ${operation.costTier}`,
        })),
        state: fixture
          ? "ready"
          : catalog.isPending
            ? "loading"
            : catalog.isError
              ? "error"
              : "ready",
        lane: fixture ? "fixture" : "live",
        stale: fixture ? false : catalog.isPending,
        at: fixture ? Date.UTC(2026, 7, 30, 18, 42, 0) : catalog.dataUpdatedAt || undefined,
        basis: fixture ? ["fixture.ops.catalog"] : ["host.ops.catalog"],
        note: fixture
          ? "checked-in review catalog"
          : catalog.error instanceof Error
            ? catalog.error.message
            : undefined,
      },
    }),
    [
      catalog.dataUpdatedAt,
      catalog.error,
      catalog.isError,
      catalog.isFetching,
      catalog.isPending,
      fleet,
      fixture,
      operations,
    ],
  );
  const state = useMemo<BindingState<OpsSlot>>(
    () => ({
      bound: { world: world || null, op: op || null },
      multi: {},
      stage: "explore",
    }),
    [world, op],
  );
  const product = useMemo(
    () =>
      OPS_PRODUCT(feeds, {
        run: () => {
          if (fixture) throw Error("fixture review refuses operation runs");
          if (!selected || !session) throw Error("bind an operation and world first");
          return store.actions.run({
            opKey: selected.key,
            request: () =>
              mode === "form" && requestSchema
                ? buildFormRequest(requestSchema, formValues, requestSchema)
                : args.trim()
                  ? JSON.parse(args)
                  : undefined,
            target: session.sdkSessionId ?? `pid:${session.processId}`,
            bridgeSessionId: session.sessionId,
          });
        },
        refuse: () =>
          fixture
            ? "fixture review refuses operation runs"
            : opsRefusal(selected, session?.custody),
      }),
    [args, feeds, fixture, formValues, mode, requestSchema, selected, session, store],
  );
  const b = useBindings(
    product,
    state,
    (patch) => {
      const nextWorld = patch.bound?.world ?? world;
      const nextResolution = resolveTarget(fleet.sessions, nextWorld || "");
      const nextSession = nextResolution.kind === "resolved" ? nextResolution.session : null;
      void store.actions.setBindings(
        patch,
        nextSession
          ? {
              target: nextSession.sdkSessionId ?? `pid:${nextSession.processId}`,
            }
          : null,
      );
    },
    picker.open,
    (open) => store.actions.setPicker((previous) => ({ ...previous, open })),
    picker.level,
    (level) => store.actions.setPicker((previous) => ({ ...previous, level })),
    picker.query,
    (query) => store.actions.setPicker((previous) => ({ ...previous, query })),
  );
  const runner = useRunner(product, b, busyState?.id ?? null);

  return (
    <Workspace
      className="p-4"
      headRail={
        <div className="mx-auto w-full max-w-5xl">
          <TargetingHead
            product={product}
            b={b}
            runner={runner}
            receipt={
              result ? (
                <OutcomeLine
                  kind="receipt"
                  label={`${result.opKey} · ${result.elapsedMs}ms · target = ${result.target}`}
                />
              ) : undefined
            }
          />
        </div>
      }
      table={
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto pt-4">
          <CapabilityCatalogSection fixture={fixture ? OPS_FIXTURE_CAPABILITIES : undefined} />
          <section className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1">Glance</span>
            {syntheticOps.map((glance) => (
              <Press
                key={glance.key}
                size="caption"
                tone="neutral"
                state="selected"
                aria-pressed={selectedGlanceKey === glance.key}
                disabled={fixture}
                title={fixture ? "fixture review refuses synthetic Host runs" : undefined}
                onClick={() => store.actions.setSelectedGlance(glance.key)}
              >
                {glance.displayName}
              </Press>
            ))}
          </section>

          {selectedGlance && session ? (
            <section className="flex flex-col gap-3">
              <header>
                <div className="flex items-center gap-2">
                  <h1 className="">{selectedGlance.displayName}</h1>
                  <FactChip dashed title="composed client-side from checked-in typed operations">
                    synthetic
                  </FactChip>
                </div>
                <p className="">{selectedGlance.blurb}</p>
              </header>
              <SyntheticRunner op={selectedGlance} bridgeSessionId={session.sessionId} />
            </section>
          ) : selected ? (
            <OperationPane
              operation={selected}
              schema={requestSchema}
              bridgeSessionId={fixture ? undefined : session?.sessionId}
              args={args}
              mode={mode}
              formValues={formValues}
              result={result}
              setArgs={store.actions.setArgs}
              setMode={store.actions.setMode}
              setFormValues={store.actions.setFormValues}
            />
          ) : (
            <EmptyState story="scope" exit="bind a world, then pick an operation">
              no operation selected
            </EmptyState>
          )}
        </div>
      }
      readoutBand={
        <div className="mx-auto w-full max-w-5xl pt-2">
          <VerbLane atoms={store.atoms} />
          <Provenance>
            {fixture
              ? "catalog = checked-in fixture · route document and receipt are local"
              : "catalog = host.ops.catalog · selected live key is the route's one dynamic /call"}
          </Provenance>
        </div>
      }
    />
  );
}
