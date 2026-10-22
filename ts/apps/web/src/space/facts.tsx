/**
 * The picture pane's side: what the pick is (its PrimRow or scene handle, Selection Box beside it),
 * the visibility verbs, the row encoding's legend, and one small form per answer layer that is on.
 * Every read runs a manifest verb; its answer lands on the Page and the layer draws it.
 */
import { useState, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { tokenRef } from "@pe/kit/lib/token";
import { Switcher } from "#/components/lang/switcher";
import type { ActionHandle } from "#/route/handle";
import type { ElementTarget } from "#/revit/element-target";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements, useNativeObservation } from "#/revit/observation";
import type { Psc1Metadata } from "#/scene/psc1";
import { sceneTarget } from "#/scene/scene3d";
import type { SceneInstance } from "#/scene/types";

import { ENCODINGS, ENCODING_SAYS, rowAt, type Legend, type SpaceLayer } from "./layers";
import type { SpacePage } from "./manifest";

type Verb =
  | "status"
  | "rows"
  | "tree"
  | "slice"
  | "probe"
  | "sweep"
  | "hide"
  | "isolate"
  | "showAll";
type Element = Psc1Metadata["elements"][number];

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt className="text-ink-2">{name}</dt>
    <dd className="face-mono m-0 min-w-0 truncate">{children}</dd>
  </>
);

/** The pick's facts: a mesh's handle, else a row box's PrimRow; Selection Box beside it. */
export function PickFacts({
  page,
  element,
  instance,
  partition,
  actions,
}: {
  page: SpacePage;
  element: Element | null;
  instance: SceneInstance | null;
  /** The pick's source kind, as the scene stamp names it. */
  partition: string | null;
  actions: Record<Verb, ActionHandle>;
}) {
  const observation = useNativeObservation();
  const row = page.rows && page.row !== null ? rowAt(page.rows.response, page.row) : null;
  let target: ElementTarget | null = null;
  let facts: ReactNode = (
    <p className="t-small text-ink-2 m-0">Nothing picked: click a mesh or a row box.</p>
  );
  if (element && instance) {
    const h = element.handle;
    target = sceneTarget(observation, instance);
    facts = (
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 t-small m-0" data-pick-facts="mesh">
        <Fact name="partition">{partition ?? "?"}</Fact>
        <Fact name="category">{h.category}</Fact>
        <Fact name="kind">{h.kind}</Fact>
        <Fact name="element">{h.elementId}</Fact>
        <Fact name="link">{h.linkInstanceId ?? "host"}</Fact>
        <Fact name="uniqueId">{h.uniqueId}</Fact>
        {h.layer ? <Fact name="DWG layer">{h.layer}</Fact> : null}
        {h.extrusion ? (
          <Fact name="extrusion">
            {h.extrusion.maxHeightFt} ft · {h.extrusion.reasons.join("; ")}
          </Fact>
        ) : null}
        <Fact name="height role">{h.heightRole}</Fact>
        <Fact name="triangles">{(element.vertexCount / 3).toLocaleString()}</Fact>
      </dl>
    );
  } else if (row) {
    const linked = row.source?.linkInstanceId ?? null;
    target =
      row.sourceKind === "Host"
        ? observedElements(observation, [row.elementId])
        : {
            scope: observation.scope,
            ids: [],
            refs: [
              {
                elementId: null,
                documentKey: row.source?.documentKey,
                linkInstanceIds: linked === null ? [] : [linked],
              },
            ],
          };
    facts = (
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 t-small m-0" data-pick-facts="row">
        <Fact name="partition">{row.sourceKind}</Fact>
        <Fact name="category">{row.category}</Fact>
        <Fact name="kind">{row.kind}</Fact>
        <Fact name="element">{row.elementId}</Fact>
        <Fact name="link">{linked ?? "host"}</Fact>
        {row.layer ? <Fact name="DWG layer">{row.layer}</Fact> : null}
        {row.extrusionFt ? <Fact name="extrusion">{row.extrusionFt} ft</Fact> : null}
        <Fact name="height role">{row.heightRole}</Fact>
        <Fact name="triangles">{row.triangles.toLocaleString()}</Fact>
      </dl>
    );
  }
  return (
    <section className="flex flex-col gap-1" aria-label="pick">
      {facts}
      <div className="flex flex-wrap items-center gap-1">
        {target ? <SelectionBoxButton target={target} /> : null}
        {(["hide", "isolate", "showAll"] as const).map((verb) => (
          <Button
            key={verb}
            label={actions[verb].label}
            refusal={actions[verb].refusal}
            onClick={() => void actions[verb].run()}
          >
            {actions[verb].label}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** The encoding switch and its legend: one swatch per value the rows hold, with its row count. */
export function EncodingLegend({
  encoding,
  legend,
  onEncoding,
}: {
  encoding: SpacePage["encoding"];
  legend: Legend;
  onEncoding: (next: SpacePage["encoding"]) => void;
}) {
  return (
    <section className="flex flex-col gap-1" aria-label="row encoding">
      <Switcher
        ariaLabel="row encoding"
        value={encoding}
        onChange={onEncoding}
        options={ENCODINGS.map((e) => ({ value: e, label: e, title: ENCODING_SAYS[e] }))}
      />
      <ul className="m-0 flex list-none flex-wrap gap-x-3 p-0 t-small" data-legend={encoding}>
        {legend.map((entry) => (
          <li key={entry.value} className="flex items-center gap-1">
            <span className="inline-block size-2.5" style={{ background: tokenRef(entry.role) }} />
            {entry.value} <span className="text-ink-2">{entry.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const num = (text: string) => (text.trim() === "" ? NaN : Number(text));
const triple = (text: string) => text.split(",").map(num);

/** A labelled number field. */
function Field({
  label,
  value,
  onChange,
  width = "w-16",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) {
  return (
    <label className="flex items-center gap-1 t-small">
      {label}
      <span className={width}>
        <Input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

/** One form per answer layer that is on; each press runs that layer's verb. */
export function AnswerForms({
  on,
  page,
  actions,
}: {
  on: ReadonlySet<SpaceLayer>;
  page: SpacePage;
  actions: Record<Verb, ActionHandle>;
}) {
  const [band, setBand] = useState({ z0: "0", z1: "10" });
  const [tree, setTree] = useState({ source: "0", depth: "4" });
  const [at, setAt] = useState("0,0,5");
  const [path, setPath] = useState({
    polyline: "0,0,9; 20,0,9",
    width: "1",
    height: "1",
    clearance: "0.5",
  });
  const run = (verb: Verb, input?: unknown) => (
    <Button
      label={`read ${verb}`}
      refusal={actions[verb].refusal}
      onClick={() => void actions[verb].run(input)}
    >
      read
    </Button>
  );
  const says = (text: string | null) =>
    text ? <span className="t-small text-ink-2">{text}</span> : null;
  const s = page.status?.response;
  const rows = page.rows?.response;
  const sl = page.slice?.response;
  const pr = page.probe?.response;
  const sw = page.sweep?.response;
  const hit = (
    h: { handle: { category: string; elementId: number }; z: number } | null | undefined,
  ) => (h ? `${h.handle.category} ${h.handle.elementId} at z ${h.z.toFixed(2)}` : "nothing");
  return (
    <section className="flex flex-col gap-1" aria-label="answers">
      {on.has("levels") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="status">
          <b className="t-small">levels</b>
          {run("status")}
          {says(
            s
              ? `${s.levels.length} levels · epoch ${s.stamp.epoch} · ${s.stamp.fresh ? "fresh" : "stale"} · ${s.pendingIds} pending`
              : null,
          )}
        </div>
      )}
      {on.has("boxes") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="rows">
          <b className="t-small">boxes</b>
          {run("rows")}
          {says(rows ? `${rows.elementId.length.toLocaleString()} rows · ${rows.ms} ms` : null)}
        </div>
      )}
      {on.has("tree") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="tree">
          <b className="t-small">tree</b>
          <Field
            label="source"
            value={tree.source}
            onChange={(source) => setTree({ ...tree, source })}
          />
          <Field
            label="depth"
            value={tree.depth}
            onChange={(depth) => setTree({ ...tree, depth })}
          />
          {run("tree", { source: num(tree.source), maxDepth: num(tree.depth) })}
          {says(page.tree ? `${page.tree.response.nodes.length} nodes` : null)}
        </div>
      )}
      {on.has("slice") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="slice">
          <b className="t-small">slice</b>
          <Field label="z0" value={band.z0} onChange={(z0) => setBand({ ...band, z0 })} />
          <Field label="z1" value={band.z1} onChange={(z1) => setBand({ ...band, z1 })} />
          {run("slice", { z0: num(band.z0), z1: num(band.z1) })}
          {says(
            sl ? `${sl.pieces} of ${sl.total} pieces${sl.truncated ? " (truncated)" : ""}` : null,
          )}
        </div>
      )}
      {on.has("probe") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="probe">
          <b className="t-small">probe</b>
          <Field label="x,y,z ft" value={at} onChange={setAt} width="w-28" />
          {run("probe", { at: triple(at) })}
          {says(pr ? `floor ${hit(pr.floor)} · ceiling ${hit(pr.ceiling)}` : null)}
        </div>
      )}
      {on.has("sweep") && (
        <div className="flex flex-wrap items-center gap-1" data-answer="sweep">
          <b className="t-small">sweep</b>
          <Field
            label="path x,y,z; …"
            value={path.polyline}
            onChange={(polyline) => setPath({ ...path, polyline })}
            width="w-48"
          />
          <Field label="w" value={path.width} onChange={(width) => setPath({ ...path, width })} />
          <Field
            label="h"
            value={path.height}
            onChange={(height) => setPath({ ...path, height })}
          />
          <Field
            label="gap"
            value={path.clearance}
            onChange={(clearance) => setPath({ ...path, clearance })}
          />
          {run("sweep", {
            polyline: path.polyline.split(";").map(triple),
            widthFt: num(path.width),
            heightFt: num(path.height),
            clearanceFt: num(path.clearance),
          })}
          {says(
            sw
              ? sw.segments
                  .map((g) => `${g.index}: ${g.verdict} ${g.minGapFt.toFixed(2)} ft`)
                  .join(" · ")
              : null,
          )}
        </div>
      )}
    </section>
  );
}
