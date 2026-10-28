import { Fragment, type ReactNode } from "react";
import type { DuctsSheetOverview } from "@pe/agent-contracts";
import { Table } from "@pe/kit/table/table";
import type { Column } from "@pe/kit/table/model";
import { Button } from "@pe/kit/lang/button";
import { fanKey, pressure, rosterOrder, type Detail, type FanPort } from "./api";
import type { OpenSheet } from "./use-sheet";

export type ElementAnchor = (id: number) => ReactNode;
export function Roster({
  rows,
  compute,
  anchor,
  busy,
  loading = false,
}: {
  rows: FanPort[];
  compute: (fan: FanPort) => void;
  anchor: ElementAnchor;
  busy: boolean;
  loading?: boolean;
}) {
  const columns: Column<FanPort>[] = [
    {
      key: "mark",
      label: "Fan / port",
      search: (fan) => fan.mark,
      cell: (fan) => (
        <Button
          label={`Open ${fan.mark} port ${fan.portIndex}`}
          refusal={busy ? "Wait for the current read" : null}
          onClick={() => compute(fan)}
        >
          {fan.mark} · port {fan.portIndex}
        </Button>
      ),
    },
    { key: "element", label: "Element", cell: (fan) => anchor(fan.unitId) },
    {
      key: "kind",
      label: "Kind",
      cell: (fan) => (
        <>
          {fan.kind}
          {fan.confirmed === false ? " · suggestion" : ""}
        </>
      ),
    },
    { key: "side", label: "Side served", cell: (fan) => fan.side },
    {
      key: "rated",
      label: "Rated ESP · in-wg",
      right: true,
      cell: (fan) => pressure(fan.ratedEspInWg),
    },
    {
      key: "required",
      label: "Required ESP · in-wg",
      cell: (fan) =>
        fan.requiredEspInWg != null
          ? pressure(fan.requiredEspInWg)
          : fan.complete === undefined
            ? "not computed"
            : fan.complete
              ? "unavailable"
              : `incomplete: ${fan.blockerCount ?? 0} blockers`,
    },
    {
      key: "blockers",
      label: "Blockers",
      right: true,
      cell: (fan) => (
        <span data-tone={(fan.blockerCount ?? 0) > 0 ? "alarm" : undefined}>
          {fan.blockerCount ?? "—"}
        </span>
      ),
    },
    {
      key: "compute",
      label: "Compute",
      cell: (fan) => (
        <Button
          label={`Compute ${fan.mark} port ${fan.portIndex}`}
          refusal={busy ? "Wait for the current read" : null}
          onClick={() => compute(fan)}
        >
          compute
        </Button>
      ),
    },
  ];
  return (
    <Table
      label="Fan roster"
      rows={rosterOrder(rows)}
      status={loading ? "pending" : "ready"}
      columns={columns}
      rowKey={fanKey}
      maxHeight="20rem"
      empty="No fan ports found in this document"
    />
  );
}

type Side = "supply" | "return";
type Path = DuctsSheetOverview["paths"][Side]["paths"][number];
function SideSheet({
  side,
  overview,
  anchor,
  pickPath,
  busy,
}: {
  side: Side;
  overview: DuctsSheetOverview;
  anchor: ElementAnchor;
  pickPath: (id: string) => void;
  busy: boolean;
}) {
  const totals = overview.totals?.[side];
  const ranked = overview.paths[side];
  const columns: Column<Path>[] = [
    {
      key: "path",
      label: "Path",
      cell: (path) => (
        <Button
          label={`Inspect ${side} path ${path.pathId}`}
          refusal={busy ? "Wait for the current read" : null}
          onClick={() => pickPath(path.pathId)}
        >
          {path.pathId}
          {totals?.worstPath != null && String(totals.worstPath) === path.pathId ? " · worst" : ""}
        </Button>
      ),
    },
    { key: "end", label: "End kind", cell: (path) => path.end.kind },
    {
      key: "element",
      label: "End element",
      cell: (path) => (
        <>
          {anchor(path.end.elementId)}
          {path.end.connector == null ? "" : ` · connector ${path.end.connector}`}
        </>
      ),
    },
    { key: "loss", label: "Known · in-wg", right: true, cell: (path) => pressure(path.knownInWg) },
    { key: "legs", label: "Legs", right: true, cell: (path) => path.legCount },
    {
      key: "complete",
      label: "Completeness",
      cell: (path) =>
        path.complete ? "complete" : `incomplete: ${path.blockerIds.length} blockers`,
    },
  ];
  return (
    <section className="min-w-0 space-y-2" aria-label={`${side} side`}>
      <h3 className="t-head">{side}</h3>
      {totals && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Known subtotal · in-wg</dt>
          <dd>{pressure(totals.knownInWg)}</dd>
          <dt>Completeness</dt>
          <dd data-tone={totals.complete ? "done" : "alarm"}>
            {totals.complete ? "complete" : "incomplete"}
          </dd>
          <dt>Worst path</dt>
          <dd>
            {totals.worstPath == null ? (
              "none complete"
            ) : (
              <Button
                label={`Inspect worst ${side} path`}
                refusal={busy ? "Wait for the current read" : null}
                onClick={() => pickPath(String(totals.worstPath))}
              >
                {totals.worstPath}
              </Button>
            )}
          </dd>
          <dt>Allowance · in-wg</dt>
          <dd>{pressure(totals.allowanceInWg)}</dd>
          <dt>TEL · ft</dt>
          <dd>{totals.telFt.toFixed(1)}</dd>
          <dt>Friction · in-wg / 100 ft</dt>
          <dd>{pressure(totals.frictionRatePer100)}</dd>
        </dl>
      )}
      <Table
        label={`${side} ranked paths`}
        rows={ranked.paths}
        columns={columns}
        rowKey={(path) => path.pathId}
        maxHeight="15rem"
        empty={`No ${side} paths returned`}
      />
      {ranked.rest > 0 && <p className="text-ink-2">{ranked.rest} additional paths</p>}
    </section>
  );
}

export function FanSheet({
  sheet,
  anchor,
  pickPath,
  busy,
  picture,
}: {
  sheet: OpenSheet;
  anchor: ElementAnchor;
  pickPath: (id: string) => void;
  busy: boolean;
  picture?: ReactNode;
}) {
  const { overview, inputs, legs } = sheet;
  const blockers: Detail<"inputs">["blockers"] =
    inputs?.blockers ??
    overview.blockers.map((blocker) => ({
      ...blocker,
      detail: "Read blocker details to see the explanation",
      closer: { kind: blocker.closer, note: "" },
    }));
  const elementIds = new Set([
    ...(sheet.elements?.walkedElementIds ?? []),
    ...(legs?.legs.map((leg) => leg.elementId) ?? []),
    ...(overview.fan ? [overview.fan.unitId] : []),
    ...blockers.flatMap((blocker) => [
      blocker.elementId,
      blocker.owner?.unitId,
      blocker.closer.candidate?.toElementId,
    ]),
    ...[...overview.paths.supply.paths, ...overview.paths.return.paths].map(
      (path) => path.end.elementId,
    ),
  ]);
  const references = (text: string) =>
    text
      .split(/(\d+)/)
      .map((part, index) => (
        <Fragment key={index}>
          {elementIds.has(Number(part)) ? anchor(Number(part)) : part}
        </Fragment>
      ));
  const blockerColumns: Column<(typeof blockers)[number]>[] = [
    {
      key: "kind",
      label: "Kind",
      cell: (blocker) => <span data-tone="alarm">{blocker.kind}</span>,
    },
    {
      key: "element",
      label: "Element / connector",
      cell: (blocker) => (
        <>
          {anchor(blocker.elementId)}
          {blocker.connector == null ? "" : ` · connector ${blocker.connector}`}
        </>
      ),
    },
    { key: "detail", label: "Detail", cell: (blocker) => references(blocker.detail) },
    {
      key: "closer",
      label: "Closer",
      cell: (blocker) => (
        <>
          {blocker.closer.kind} · {references(blocker.closer.note)}
          {blocker.closer.candidate && (
            <>
              {" "}
              · candidate {anchor(blocker.closer.candidate.toElementId)} · connector{" "}
              {blocker.closer.candidate.toConnector ?? "unknown"}
            </>
          )}
        </>
      ),
    },
  ];
  const legColumns: Column<Detail<"legs">["legs"][number]>[] = [
    { key: "order", label: "Order", cell: (leg) => (legs?.legs.indexOf(leg) ?? -1) + 1 },
    { key: "element", label: "Element", cell: (leg) => anchor(leg.elementId) },
    { key: "kind", label: "Kind", cell: (leg) => leg.kind },
    { key: "flow", label: "Flow · cfm", cell: (leg) => leg.flowCfm?.toFixed(1) ?? "—" },
    {
      key: "flow-source",
      label: "Flow source",
      cell: (leg) => references(leg.flowSource ?? "unknown"),
    },
    { key: "velocity", label: "Velocity · fpm", cell: (leg) => leg.velocityFpm?.toFixed(1) ?? "—" },
    { key: "loss", label: "Loss · in-wg", cell: (leg) => pressure(leg.lossInWg) },
    {
      key: "loss-source",
      label: "Loss source",
      cell: (leg) => (
        <>
          {leg.lossSource.kind} · {references(leg.lossSource.ref)}
        </>
      ),
    },
    {
      key: "equivalent",
      label: "Equivalent · ft",
      cell: (leg) => leg.equivalentFt?.toFixed(1) ?? "—",
    },
  ];
  return (
    <article className="space-y-4" aria-label="Fan pressure sheet">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-head">
          {overview.fan?.mark} · port {overview.fan?.portIndex}
        </h2>
        <p data-tone={overview.totals?.requiredEspInWg == null ? "alarm" : "done"}>
          {overview.totals?.requiredEspInWg != null
            ? `Required ESP: ${pressure(overview.totals.requiredEspInWg)} in-wg`
            : `incomplete: ${overview.blockers.length} blockers`}
        </p>
        <p>Rated ESP: {pressure(overview.fan?.ratedEspInWg)} in-wg</p>
      </header>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(["supply", "return"] as const).map((side) => (
          <SideSheet
            key={side}
            side={side}
            overview={overview}
            anchor={anchor}
            pickPath={pickPath}
            busy={busy}
          />
        ))}
      </div>
      {picture}
      <section aria-label="Blockers" className="space-y-2">
        <h3 className="t-head">Blockers · {blockers.length}</h3>
        <Table
          label="Sheet blockers"
          rows={blockers}
          columns={blockerColumns}
          rowKey={(blocker) => blocker.id}
          maxHeight="20rem"
          empty="No blockers returned"
        />
      </section>
      <section aria-label="Ordered legs" className="space-y-2">
        <h3 className="t-head">
          {legs ? `Path ${legs.pathId} · ordered legs` : "Choose a path to inspect its legs"}
        </h3>
        {legs && (
          <Table
            label="Ordered path legs"
            rows={legs.legs}
            columns={legColumns}
            rowKey={(leg) => leg.id}
            maxHeight="24rem"
            empty="No legs returned"
          />
        )}
      </section>
      <details>
        <summary>Basis and inputs</summary>
        <p className="break-all face-mono">{overview.basis}</p>
        {inputs?.inputs.map((input, index) => (
          <p key={`${input.name}:${index}`}>
            {references(input.name)} · {references(String(input.value ?? "unknown"))} ·{" "}
            {references(input.source)}
          </p>
        ))}
      </details>
    </article>
  );
}
