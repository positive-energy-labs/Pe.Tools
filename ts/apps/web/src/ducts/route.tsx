import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { stagedDucts, type DuctsRouteDocument, type RouteStatePatch } from "@pe/agent-contracts";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { pendingCount } from "@pe/ducts-domain/staged";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { routeFromGraph, type RouteAdapters, type GraphMount } from "#/shell/mount";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { ductsGraph, type DuctsPage } from "./graph";
import { ductsSources } from "./sources";
import { ductsBinding } from "./actions";
import { NetworkPane, NetworkProvider } from "./proto/e/screen";
import { SheetPane, SheetProvider } from "./sheet/mount";
import { DuctsOwner, PaneBody, commands } from "./pane-context";
import { claimsOf, type Claim } from "./legs";
import { verdictPatches } from "./claims";
import type { ProtoProps } from "./proto/props";
import { rememberAnalysis, type PricingResult } from "./pricing-job";

/** Context-only view projection. The kernel owns Target, Work, Page, reading demand and invocations. */
function DuctsProvider({
  owner,
  children,
}: {
  owner: GraphMount<DuctsPage, DuctsRouteDocument>;
  children: ReactNode;
}) {
  const { target, work } = owner.snapshot();
  const page = owner.view.read().page;
  const doc = target.kind === "document" ? target.ref : null;
  const read = owner.readings.get(page.stage === "sheet" ? "sheetSnapshot" : "ducts");
  const snapshot = (read.value ?? read.previous ?? null) as DuctSnapshot | null;
  const pricing = owner.readings.get("pricing");
  const priced =
    page.stage === "network"
      ? ((pricing.value ?? pricing.previous) as PricingResult | undefined)
      : undefined;
  const catalogs = owner.readings.get("catalogs").value as { findings?: string[] } | undefined;
  const edit = useMemo(() => stagedDucts(work?.doc ?? null), [work?.doc]);
  const seen = useMemo(
    () => withStoredRulings(work?.doc ?? null, snapshot?.store),
    [work?.doc, snapshot],
  );
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "ducts:unbound";
  const selection = useMemo(
    () =>
      Atom.make((get): ReadonlySet<SubjectKey> => {
        const current = get(owner.view.state).page;
        return new Set(
          current.selected && /^\d+$/.test(current.selected)
            ? [elementKey(current.selected)]
            : current.selected && /^(run|section):/.test(current.selected)
              ? [current.selected as SubjectKey]
              : current.issue
                ? [`issue:${current.issue}` as SubjectKey]
                : [],
        );
      }),
    [owner],
  );
  const setPage: ProtoProps["setPage"] = useCallback(
    (next, move) => owner.view.setPage(next, move),
    [owner],
  );
  const write = useCallback(
    async (patches: RouteStatePatch[]) => {
      const result = await owner
        .control("edit", { patches, expectedRevision: work?.handle.revision ?? -1 })
        .run();
      return "refusal" in result ? result.refusal : null;
    },
    [owner, work?.handle.revision],
  );
  const onVerdict = useCallback(
    (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => {
      void write(verdictPatches(work?.doc ?? null, claim, verdict));
    },
    [work?.doc, write],
  );
  const claimCells = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(work?.doc.claims ?? {}).flatMap(([id, cell]) => {
          const value = cell.edit?.value ?? cell.suggestion?.value;
          return value ? [[id, value] as const] : [];
        }),
      ),
    [work?.doc],
  );
  const scope = useMemo(
    () => (snapshot ? scopeOf(snapshot, page.system) : null),
    [snapshot, page.system],
  );
  const claims = useMemo(
    () => claimsOf(scope ? claimsForGroup(claimCells, [...scope.members]) : claimCells),
    [scope, claimCells],
  );
  const subjectIds = scope?.groups
    .map((group) => edit.subject[group] ?? work?.doc.subject[group]?.suggestion?.value)
    .find((ids) => ids != null);
  const current = read.current && (page.stage === "sheet" || pricing.current);
  const version = read.basis?.sourceVersion;
  const observation = useMemo<NativeObservation>(
    () => ({
      scope: { document: current ? doc : null, source: "native" },
      references: [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].map((element) => ({
        elementId: element.id,
        uniqueId: element.uniqueId,
      })),
    }),
    [current, doc?.session, doc?.openId, snapshot],
  );
  // Install the worker's exact analysis before any pane asks cached domain projections for it.
  if (priced && snapshot && current) {
    const grids = owner.readings.get("tables").value as import("@pe/ducts-domain/loss-grid").Grids;
    const catalog = owner.readings.get("catalogs").value as {
      tables: import("@pe/ducts-domain/catalog").Catalogs;
    };
    rememberAnalysis(
      {
        snapshot,
        grids,
        catalogs: catalog.tables,
        doc: work?.doc ?? null,
      },
      priced,
    );
  }
  const roster = owner.readings.get("roster").value as DuctSnapshot | null;
  const readSystems =
    snapshot?.systems.filter((system) =>
      snapshot.groups.some((group) => group.systemNames.includes(system.name)),
    ).length ?? 0;
  const props: ProtoProps = {
    attentionDoc,
    selection,
    snapshot,
    priced: priced?.priced ?? null,
    pricing:
      page.stage === "network" &&
      !!snapshot?.groups.length &&
      !priced &&
      pricing.status === "pending",
    findings: catalogs?.findings ?? [],
    ready: priced?.ready ?? {},
    analysis: priced?.analysis ?? null,
    subject: subjectIds ? { ids: subjectIds, claims, work: work?.doc ?? null, onVerdict } : null,
    claims,
    onVerdict,
    claimCells,
    page,
    setPage,
    onSelect: (id) => setPage({ selected: id == null ? "" : String(id), issue: "" }),
    onSelectClaim: (claim) => setPage({ selected: claim.id, issue: "" }),
    work: {
      doc: seen,
      revision: work?.handle.revision ?? null,
      write: write as ProtoProps["work"]["write"],
    },
    empty: !doc
      ? { says: "No document bound", exit: "Choose an open project document" }
      : !snapshot
        ? { says: "Reading ducts", exit: "Wait for this document's snapshot" }
        : null,
    doc,
    captureSource: current && doc && version ? { document: doc, version } : null,
    reading: {
      pending: read.status === "pending",
      error:
        read.error ??
        (page.stage === "network"
          ? (owner.readings.get("roster").error ??
            owner.readings.get("tables").error ??
            owner.readings.get("catalogs").error ??
            pricing.error)
          : null) ??
        null,
      refreshing: !current && !!snapshot,
    },
    commands,
    cells: commands,
    busy: owner.busy() !== null,
    edit: pendingCount(work?.doc ?? null, snapshot?.store),
    coverage:
      page.stage === "network" && roster
        ? {
            read: readSystems,
            of: roster.systems.length,
            reading: read.status === "pending" ? page.system : [],
            readAll:
              page.readAll || readSystems === roster.systems.length
                ? null
                : () => setPage({ readAll: true }),
          }
        : null,
  };
  return (
    <RegistryContext value={owner.registry}>
      <DuctsOwner value={owner}>
        <NativeObservationScope value={observation}>
          {page.stage === "sheet" ? (
            <SheetProvider props={props}>{children}</SheetProvider>
          ) : (
            <NetworkProvider props={props}>{children}</NetworkProvider>
          )}
        </NativeObservationScope>
      </DuctsOwner>
    </RegistryContext>
  );
}

export const ductsAdapters: RouteAdapters<DuctsPage, DuctsRouteDocument> = {
  sources: ductsSources(),
  binding: ductsBinding,
  cell: (row, scope) => {
    const value = row as { segment?: string; key?: string; id?: string | number } | null;
    const segment = value?.segment;
    const key = value?.key ?? value?.id;
    if (
      !scope.work ||
      !segment ||
      key == null ||
      !ductsGraph.cells!.some((family) => family.segment === segment)
    )
      return null;
    return {
      type: `cell:${segment}`,
      id: String(key),
      work: scope.work.handle.key,
      path: [segment, String(key)],
    };
  },
  subjects: {},
  verbReadings: {},
  receiptPaths: (receipt) => {
    // Price publishes the model provenance store over the whole Work. Native topology changes do too.
    return ["ducts.apply-losses", "ducts.apply-heal", "ducts.apply-assign-fan"].includes(
      receipt.key,
    )
      ? [[]]
      : [];
  },
  wrap: (owner, children) => <DuctsProvider owner={owner}>{children}</DuctsProvider>,
  bodies: Object.fromEntries(
    Object.keys(ductsGraph.panes).map((id) => [
      id,
      (body) => (
        <PaneBody value={body}>
          {id.startsWith("sheet-") ? <SheetPane id={id} /> : <NetworkPane id={id} />}
        </PaneBody>
      ),
    ]),
  ),
};
export const ductsRoute = routeFromGraph(ductsGraph, ductsAdapters, "/ducts");
