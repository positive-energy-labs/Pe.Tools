/**
 * The Ops body. The route declares itself in `ops/manifest.ts`; this file draws it. The fixture
 * lane, the Product/Feeds/Slot binding machinery and the `?source=fixture` branch are deleted —
 * the catalogue is one Reading and the one action is the manifest's `run`.
 */
import { useEffect, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";

import { ActionReceiptView } from "#/actions/receipt";
import { Workspace } from "#/components/anatomy";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { Provenance } from "#/components/lang/section";
import { previousOf, sessionKey, useFleet } from "#/readings";
import { RouteShell, useRoute, appAtomRegistry, useRouteOwner } from "#/route";
import { CapabilityCatalogSection } from "#/ops/capability-catalog";
import { syntheticOps } from "#/ops/glance";
import { opsManifest, type HostOperationCatalogEntry } from "#/ops/manifest";
import { OperationPane, parseSchema } from "#/ops/operation-pane";
import { buildFormRequest, readFormSeed } from "#/ops/schema-form";
import { createOpsStore, type OpsPageSeed, type OpsStore } from "#/ops/store";
import { SyntheticRunner } from "#/ops/synthetic";

export type HostOperationJsonSchema = Record<string, unknown>;

export function OpsRoute({
  initial,
  onSeed,
}: {
  initial?: Partial<OpsPageSeed>;
  onSeed?: (seed: OpsPageSeed) => void;
}) {
  return <OpsStoreOwner initial={initial} onSeed={onSeed} />;
}

export function OpsStoreOwner({
  initial,
  onSeed,
}: {
  initial?: Partial<OpsPageSeed>;
  onSeed?: (seed: OpsPageSeed) => void;
}) {
  const store = useRouteOwner(() => createOpsStore({ registry: appAtomRegistry, initial, onSeed }));
  return <OpsPage store={store} />;
}

export function OpsPage({ store }: { store: OpsStore }) {
  const actionId = useAtomValue(store.atoms.actionId);
  const world = useAtomValue(store.atoms.world);
  const op = useAtomValue(store.atoms.op);
  const fleet = useFleet();
  const session = fleet.sessions.find(
    (row) => row.sessionId === world || sessionKey(row) === world,
  );
  const openDocumentId = useAtomValue(store.atoms.openDocumentId);
  const args = useAtomValue(store.atoms.args);
  const mode = useAtomValue(store.atoms.mode);
  const formValues = useAtomValue(store.atoms.formValues);
  const selectedGlanceKey = useAtomValue(store.atoms.selectedGlance);
  const result = useAtomValue(store.atoms.result);
  const selectedGlance = syntheticOps.find((glance) => glance.key === selectedGlanceKey);

  // The generated operation catalogue is one Reading. The route declares it; the body reads it.
  const declared = useMemo(() => opsManifest(), []);
  const catalogReading = useRoute(declared).readings.catalog;
  const catalogValue = previousOf(catalogReading) as
    | { operations?: HostOperationCatalogEntry[]; bridgeCatalogError?: string }
    | undefined;
  const operations = useMemo(() => catalogValue?.operations ?? [], [catalogValue]);
  const selected = operations.find((operation) => operation.key === op);
  const selectedOpen = session?.openDocuments?.find(
    (doc) =>
      doc.openId === openDocumentId &&
      (selected?.needs !== "family-document" || doc.isFamilyDocument) &&
      (selected?.needs !== "project-document" || !doc.isFamilyDocument),
  );
  const requestSchema = selected?.requestSchemaJson
    ? parseSchema(selected.requestSchemaJson)
    : undefined;

  const currentIdentity = useMemo(
    () =>
      session ? { target: session.sdkSessionId ?? `pid:${session.processId}` } : { target: "host" },
    [session],
  );

  useEffect(() => {
    void store.actions.syncBindings(world, op, currentIdentity);
  }, [world, op, currentIdentity, store]);
  useEffect(() => {
    const seed = selected?.requestExamples?.[0]?.json ?? selected?.safeDefaultRequestJson ?? "{}";
    store.actions.select(selected, readFormSeed(seed, requestSchema));
  }, [requestSchema, selected, store]);

  const manifest = useMemo(
    () =>
      opsManifest({
        ...(selected ? { selected } : {}),
        ...(session?.custody === "controlled" || session?.custody === "observed"
          ? { custody: session.custody }
          : {}),
        request: () =>
          mode === "form" && requestSchema
            ? buildFormRequest(requestSchema, formValues, requestSchema)
            : args.trim()
              ? JSON.parse(args)
              : undefined,
        run: ({ opKey, request }) =>
          store.actions.run({
            opKey,
            request,
            target: session ? sessionKey(session) : "host",
            ...(session?.sessionId ? { bridgeSessionId: session.sessionId } : {}),
            ...(openDocumentId ? { openDocumentId } : {}),
          }),
      }),
    [selected, session, openDocumentId, args, mode, formValues, requestSchema, store],
  );

  return (
    <>
      {actionId && <ActionReceiptView id={actionId} />}
      {catalogValue?.bridgeCatalogError && (
        <div role="status">
          Native catalogue unavailable: {catalogValue.bridgeCatalogError}. Host operations remain
          available.
        </div>
      )}
      {session && (
        <label>
          Open document{" "}
          <select
            aria-label="Open document"
            value={openDocumentId}
            onChange={(event) => store.actions.setOpenDocumentId(event.target.value)}
          >
            <option value="">Select an exact open document</option>
            {session.openDocuments?.map((doc) => (
              <option key={doc.openId} value={doc.openId}>
                {doc.title ?? doc.address ?? doc.openId}
              </option>
            ))}
          </select>
        </label>
      )}
      <Workspace
        className="p-4"
        headRail={
          <div className="mx-auto w-full max-w-5xl">
            <RouteShell manifest={manifest}>
              {result ? (
                <OutcomeLine
                  kind="receipt"
                  label={`${result.opKey} · ${result.elapsedMs}ms · target = ${result.target}`}
                />
              ) : null}
            </RouteShell>
          </div>
        }
        table={
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto pt-4">
            <CapabilityCatalogSection />
            <section className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1">Glance</span>
              {syntheticOps.map((glance) => (
                <Press
                  key={glance.key}
                  size="caption"
                  tone="neutral"
                  state="selected"
                  aria-pressed={selectedGlanceKey === glance.key}
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
                bridgeSessionId={session?.sessionId}
                openDocumentId={selectedOpen?.openId}
                args={args}
                mode={mode}
                formValues={formValues}
                result={result}
                setArgs={store.actions.setArgs}
                setMode={store.actions.setMode}
                setFormValues={store.actions.setFormValues}
              />
            ) : (
              <EmptyState
                story="scope"
                exit="pick an operation; select Revit only when it needs it"
              >
                no operation selected
              </EmptyState>
            )}
          </div>
        }
        readoutBand={
          <div className="mx-auto w-full max-w-5xl pt-2">
            <Provenance>
              catalog = host.ops.catalog · mutations use the host action journal
            </Provenance>
          </div>
        }
      />
    </>
  );
}
