import * as Atom from "effect/reactivity/Atom";
import { useCallback, useMemo } from "react";
import { stagedDucts, type DuctsRouteDocument, type RouteStatePatch } from "@pe/agent-contracts";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { scopeOf } from "@pe/ducts-domain/system-scope";
import { pendingCount } from "@pe/ducts-domain/staged";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type {
  PaneContext,
  ReadingSnapshot,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type {
  WorkWriteOutcome,
  Observation,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { activeName, ductsData, schemas, entries, localId, localSubject, namesOf } from "./neutral";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import { NetworkPane, NetworkProvider } from "./proto/e/screen";
import { SheetPane, SheetProvider } from "./sheet/mount";
import { DuctsOwner, commands } from "./pane-context";
import { claimsOf, type Claim } from "./legs";
import { verdictPatches } from "./claims";
import type { ProtoProps } from "./proto/props";
import { rememberAnalysis, type PricingResult } from "./pricing-job";
import type { EditMeta } from "./sheet/input-history";
import { systemReadCoverage } from "./system-reads";
import { Button } from "@pe/kit/lang/button";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { healTarget, offeredFan } from "@pe/ducts-domain/action-targets";
import { elementNamer } from "./claims";

type KernelContext = PaneContext<
  typeof ductsData,
  typeof schemas,
  typeof entries,
  keyof typeof ductsData.panes
>;
export type DuctsViewContext = Pick<KernelContext, "work" | "workBasis" | "history" | "verbs"> & {
  readonly page: Pick<KernelContext["page"], "select" | "pose"> & {
    read(): Omit<ReturnType<KernelContext["page"]["read"]>, "stage">;
  };
  readonly readings: Readonly<Partial<Record<string, ReadingSnapshot<unknown>>>>;
};
const unavailable: ReadingSnapshot<unknown> = {
  status: "unavailable",
  current: false,
  reason: "Not requested",
};
export function settled(
  write: Observation<WorkWriteOutcome> | { kind: "refused"; reason: "describe-threw" },
): Promise<WorkWriteOutcome> {
  if ("kind" in write)
    return Promise.resolve({
      kind: "refused",
      refusal: {
        kind: "error",
        error: "Could not name this edit",
        hint: "Retry the current input",
      },
    });
  return new Promise((resolve) => {
    write.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    );
  });
}
export function DuctsPane({ ctx, id }: { ctx: DuctsViewContext; id: string }) {
  const read = (key: string) => ctx.readings[key] ?? unavailable;
  const workDoc = ctx.work as DuctsRouteDocument | null;
  const target = ctx.workBasis?.token.scope.identity.target ?? { kind: "host" as const };
  const authored = ctx.page.read();
  const roster = read("roster").value as DuctSnapshot | null;
  const system = namesOf(authored.system);
  const page = {
    ...authored,
    stage: id.startsWith("sheet-") ? "sheet" : "network",
    system: system === "all" ? (roster?.systems ?? []).map((system) => system.name) : system,
    active: activeName(
      authored.system,
      (roster?.systems ?? []).map((system) => system.name),
    ),
    fan: namesOf(authored.fan),
    selected: authored.selected.map((item) => localSubject(item.id)).join(","),
    heal: null,
  } as ProtoProps["page"];
  const doc = target.kind === "document" ? target.ref : null;
  const networkRead = read(page.stage === "sheet" ? "sheetSnapshot" : "ducts");
  const snapshot = (networkRead.value ?? null) as import("./neutral").SnapshotReading | null;
  const pricing = read("pricing");
  const priced =
    page.stage === "network" && pricing.status !== "failed"
      ? (pricing.value as PricingResult | undefined)
      : undefined;
  const catalogs = read("catalogs").value as { findings?: string[] } | undefined;
  const edit = useMemo(() => stagedDucts(workDoc ?? null), [workDoc]);
  const seen = useMemo(
    () => withStoredRulings(workDoc ?? null, snapshot?.store),
    [workDoc, snapshot],
  );
  const attentionDoc = doc ? `${doc.session}/${doc.openId}` : "ducts:unbound";
  const selection = useMemo(
    () =>
      Atom.make<ReadonlySet<SubjectKey>>(
        new Set(
          page.selected
            ? [
                page.selected.startsWith("run:") || page.selected.startsWith("section:")
                  ? (page.selected as SubjectKey)
                  : /^\d+$/.test(page.selected)
                    ? elementKey(page.selected)
                    : (`issue:${page.selected}` as SubjectKey),
              ]
            : [],
        ),
      ),
    [page.selected],
  );
  const setPage: ProtoProps["setPage"] = useCallback(
    (next, move) => {
      const {
        selected,
        contextRadiusFt,
        sceneView,
        encoding,
        layers,
        contextStyle,
        picture,
        viewport,
        ...query
      } = next;
      if (selected !== undefined)
        ctx.page.select(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
      const pose = {
        ...(contextRadiusFt !== undefined && { contextRadiusFt }),
        ...(sceneView !== undefined && { sceneView }),
        ...(encoding !== undefined && { encoding }),
        ...(layers !== undefined && { layers }),
        ...(contextStyle !== undefined && { contextStyle }),
        ...(picture !== undefined && { picture }),
        ...(viewport !== undefined && { viewport }),
      };
      if (Object.keys(pose).length)
        ctx.page.pose(pose, move?.history === "replace" ? "gesture" : "named");
      if (Object.keys(query).length) ctx.verbs.browse(query);
    },
    [ctx],
  );
  const write = useCallback(
    async (patches: RouteStatePatch[], history?: EditMeta) => {
      if (!ctx.workBasis)
        return { code: "unavailable", message: "Read this document's Work before editing" };
      const result = await settled(ctx.verbs.edit({ patches, history }, ctx.workBasis));
      return result.kind === "refused" ? { code: "refused", message: result.refusal.error } : null;
    },
    [ctx],
  );
  const onVerdict = useCallback(
    (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => {
      void write(verdictPatches(workDoc, claim, verdict));
    },
    [workDoc, write],
  );
  const claimCells = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(workDoc?.claims ?? {}).flatMap(([id, cell]) => {
          const value = cell.edit?.value ?? cell.suggestion?.value;
          return value ? [[id, value]] : [];
        }),
      ),
    [workDoc],
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
    .map((group) => edit.subject[group] ?? workDoc?.subject[group]?.suggestion?.value)
    .find((ids) => ids != null);
  const pictureRead = page.stage === "sheet" ? read("fans") : networkRead;
  const current = networkRead.current;
  const version = snapshot?.sourceVersion;
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
  if (priced && snapshot && pricing.current) {
    const grids = read("tables").value as import("@pe/ducts-domain/loss-grid").Grids;
    const catalog = read("catalogs").value as {
      tables: import("@pe/ducts-domain/catalog").Catalogs;
    };
    rememberAnalysis(
      {
        snapshot,
        grids,
        catalogs: catalog.tables,
        doc: workDoc ?? null,
      },
      priced,
    );
  }
  const coverage = roster ? systemReadCoverage(snapshot, roster) : null;
  const stageScope = async (row: {
    kind?: string;
    group?: string;
    unitId?: number;
    systemId?: number;
  }) => {
    if (!ctx.workBasis || !snapshot) return;
    const active = page.active;
    switch (row.kind) {
      case "price": {
        const sheet = read("sheet").value as import("./neutral").SheetReading | null;
        if (page.stage === "sheet") {
          if (!sheet?.open?.overview.fan || (sheet.opened?.length ?? 1) > 1) return;
          const { unitId, portIndex } = sheet.open.overview.fan;
          return ctx.verbs.scope({ walk: { unitId, portIndex } }, ctx.workBasis);
        }
        const groups = active ? systemScope(snapshot, active).groups : [];
        if (groups.length) return ctx.verbs.scope({ groups: [...groups] }, ctx.workBasis);
        return;
      }
      case "heal":
      case "heal-preview": {
        const group = row.group ?? healTarget(snapshot, workDoc, active, page.selected, null);
        if (active && systemScope(snapshot, active).groups.includes(group))
          return ctx.verbs.scope({ groups: [group] }, ctx.workBasis);
        return;
      }
      case "assign-fan": {
        const fan =
          row.unitId != null && row.systemId != null
            ? { unitId: row.unitId, systemId: row.systemId }
            : offeredFan(
                snapshot,
                workDoc,
                (read("tables").value ?? {}) as import("@pe/ducts-domain/loss-grid").Grids,
                (read("catalogs").value as { tables: import("@pe/ducts-domain/catalog").Catalogs })
                  .tables,
                active,
                page.selected,
                null,
                elementNamer(snapshot, null),
              );
        if (snapshot.systems.find((system) => system.id === fan.systemId)?.name === active)
          return ctx.verbs.scope({ fan }, ctx.workBasis);
        return;
      }
    }
  };
  const scopeCommand = (row?: unknown) => {
    const choice = row as
      | { kind?: string; group?: string; unitId?: number; systemId?: number }
      | undefined;
    return choice?.kind && ["price", "heal", "heal-preview", "assign-fan"].includes(choice.kind) ? (
      <Button
        label="Choose write scope"
        onClick={() => {
          void stageScope(choice);
        }}
      >
        Choose write scope
      </Button>
    ) : null;
  };
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
    subject: subjectIds ? { ids: subjectIds, claims, work: workDoc ?? null, onVerdict } : null,
    claims,
    onVerdict,
    claimCells,
    page,
    setPage,
    onSelect: (id) => setPage({ selected: id == null ? "" : String(id) }),
    onSelectClaim: (claim) => setPage({ selected: claim.id }),
    work: {
      doc: seen,
      revision: ctx.workBasis?.workRevision ?? null,
      write: write as ProtoProps["work"]["write"],
    },
    empty: !doc
      ? { says: "No document bound", exit: "Choose an open project document" }
      : !snapshot
        ? { says: "Reading ducts", exit: "Wait for this document's snapshot" }
        : null,
    doc,
    // Fan overview depends on the roster, not the optional sheet detail reads.
    captureSource: pictureRead.current && doc && version ? { document: doc, version } : null,
    reading: {
      pending: networkRead.status === "pending",
      error:
        (page.stage === "network"
          ? read("roster").status === "failed"
            ? "System roster failed"
            : null
          : null) ??
        (networkRead.status === "failed" ? networkRead.reason : null) ??
        (page.stage === "network"
          ? ((read("tables").status === "failed" ? "Tables failed" : null) ??
            (read("catalogs").status === "failed" ? "Catalogs failed" : null) ??
            (pricing.status === "failed" ? pricing.reason : null))
          : null) ??
        null,
      refreshing:
        (!(page.stage === "sheet" ? pictureRead.current : networkRead.current) ||
          (page.stage === "network" && pricing.status !== "failed" && !pricing.current)) &&
        !!snapshot,
    },
    commands,
    cells: commands,
    busy: false,
    edit: pendingCount(workDoc ?? null, snapshot?.store),
    coverage:
      page.stage === "network" && coverage
        ? {
            ...coverage,
            reading: networkRead.status === "pending" ? page.system : [],
          }
        : null,
  };
  const sheetRead = read("sheet") as ReadingSnapshot<import("./neutral").SheetReading | null>;
  const fanRead = read("fans") as ReadingSnapshot<
    import("@pe/agent-contracts").DuctsRosterResponse | null
  >;
  return (
    <DuctsOwner
      value={{
        props,
        commands: scopeCommand,
        fanRoster: (fanRead.value?.rows ?? []) as import("./sheet/model").FanPort[],
        meshes: read("meshes").value as import("#/scene/types").SceneMeshes | undefined,
        sheetRead,
        fanRead,
        history: ctx.history,
        write,
        sheetEdit: async (edits, history, basis) => {
          if (!ctx.workBasis)
            return { code: "unavailable", message: "Read this document's Work before editing" };
          const result = await settled(
            ctx.verbs.sheetEdit({ edits, history, basis }, ctx.workBasis),
          );
          return result.kind === "refused"
            ? { code: "refused", message: result.refusal.error }
            : null;
        },
      }}
    >
      <NativeObservationScope value={observation}>
        {page.stage === "sheet" ? (
          <SheetProvider props={props}>
            {id === "sheet-inputs" && scopeCommand({ kind: "price" })}
            <SheetPane id={id} />
          </SheetProvider>
        ) : (
          <NetworkProvider props={props}>
            <NetworkPane id={id} />
          </NetworkProvider>
        )}
      </NativeObservationScope>
    </DuctsOwner>
  );
}
