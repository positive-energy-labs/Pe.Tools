/**
 * What the picture is of, for its fixed readout (the scene's summary, or what the pick is: its
 * PrimRow or scene handle, Selection Box beside it, and the visibility verbs), and for the pane's
 * side the row encoding's legend and one small form per answer layer that is on.
 * Every native read runs a kernel query; its receipt supplies the answer layer.
 */
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import { Input, Label } from "@pe/kit/lang/input";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { tokenRef } from "@pe/kit/lib/token";
import { Legend as KitLegend, legendWord } from "@pe/kit/lang/legend";
import { Switcher } from "@pe/kit/lang/switcher";
import type { ElementTarget } from "#/revit/element-target";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements, useNativeObservation } from "#/revit/observation";
import type { Psc1Metadata } from "#/scene/psc1";
import { sceneTarget } from "#/scene/scene-target";
import type { SceneInstance } from "#/scene/types";

import { ENCODINGS, ENCODING_SAYS, rowAt, type Legend, type SpaceLayer } from "./layers";
import type { SpacePage } from "./graph";
import type { SpaceAnswers } from "./reads";

type Element = Psc1Metadata["elements"][number];

/** Capture's authored scope: individual numeric identities, never the array's wire encoding. */
export function HostIds({
  page,
  setPage,
}: {
  page: SpacePage;
  setPage(this: void, patch: Partial<SpacePage>): void;
}) {
  const [draft, setDraft] = useState("");
  const id = Number(draft);
  const refusal =
    !Number.isSafeInteger(id) || id <= 0
      ? "Enter a positive whole host element ID"
      : page.ids.includes(id)
        ? "This host element is already named"
        : null;
  const add = () => {
    if (refusal) return;
    setPage({ ids: [...page.ids, id] });
    setDraft("");
  };
  return (
    <section aria-label="Host elements" className="flex flex-wrap items-center gap-1">
      <Label>
        Host element ID
        <Input
          aria-label="Host element ID"
          type="number"
          min={1}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            add();
          }}
        />
      </Label>
      <Button label="Add host element ID" refusal={refusal} onClick={add}>
        add
      </Button>
      {page.ids.map((id, index) => (
        <Button
          key={`${id}:${index}`}
          label={`Remove host element ${id}`}
          onClick={() => setPage({ ids: page.ids.filter((value) => value !== id) })}
        >
          {id} ×
        </Button>
      ))}
    </section>
  );
}

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt className="text-ink-2">{name}</dt>
    <dd className="face-mono m-0 min-w-0 truncate">{children}</dd>
  </>
);

/**
 * A pick's Subject name: its category, the DWG layer it came from, and "linked" when it lives in a
 * link. The element id is a fact beneath the name, never the name (SURFACE-PHILOSOPHY I1).
 * TODO(S2): render through the kit Subject text once it lands, so the name also footnotes the picture.
 */
export const pickName = (h: {
  category: string;
  layer?: string | null;
  linkInstanceId?: number | null;
  source?: { linkInstanceId?: number | null } | null;
}) =>
  [h.category, h.layer, (h.linkInstanceId ?? h.source?.linkInstanceId) != null ? "linked" : null]
    .filter(Boolean)
    .join(" · ");

/** Visibility is shareable Page state; these controls never touch the model. */
function VisibilityControls({
  page,
  setPage,
}: {
  page: SpacePage;
  setPage: (patch: Partial<SpacePage>) => void;
}) {
  return (
    <>
      <Button
        label="hide"
        refusal={page.selected ? null : "Pick an element"}
        onClick={() =>
          page.selected &&
          setPage({ hidden: [...new Set([...page.hidden, page.selected])], selected: null })
        }
      >
        hide
      </Button>
      <Button
        label="isolate"
        refusal={page.selected ? null : "Pick an element"}
        onClick={() =>
          page.selected &&
          setPage({
            isolated: [page.selected],
            hidden: page.hidden.filter((key) => key !== page.selected),
          })
        }
      >
        isolate
      </Button>
      <Button
        label="show all"
        refusal={page.hidden.length || page.isolated !== null ? null : "Everything is shown"}
        onClick={() => setPage({ hidden: [], isolated: null })}
      >
        show all
      </Button>
    </>
  );
}

/** The readout with nothing picked: what the scene is and the state it is in. */
export function SceneSummary({
  metadata,
  demo,
  page,
  setPage,
}: {
  metadata: Psc1Metadata;
  demo: boolean;
  page: SpacePage;
  setPage: (patch: Partial<SpacePage>) => void;
}) {
  const missing = metadata.unavailableElements;
  return (
    <section className="flex flex-col gap-1" aria-label="scene">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 t-small m-0" data-scene-summary="">
        <Fact name="scene">
          {metadata.phase === "focus" ? "the named elements" : "with context"}
        </Fact>
        <Fact name="elements">{metadata.elements.length.toLocaleString()}</Fact>
        <Fact name="read">
          {demo ? "fixture" : metadata.stamp.fresh ? "fresh" : "stale"} · epoch{" "}
          {metadata.stamp.epoch}
        </Fact>
        {missing.length ? (
          <>
            <dt data-tone="caution">no mesh</dt>
            <TooltipHint content={missing.map((e) => `${e.elementId} ${e.reason}`).join("\n")}>
              <dd className="face-mono m-0 min-w-0 truncate">
                {missing.length} ·{" "}
                {missing
                  .map((e) => e.reason)
                  .filter((r, i, all) => all.indexOf(r) === i)
                  .join(", ")}
              </dd>
            </TooltipHint>
          </>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center gap-1">
        <VisibilityControls page={page} setPage={setPage} />
      </div>
    </section>
  );
}

/** The pick's facts: a mesh's handle, else a row box's PrimRow; Selection Box beside it. */
export function PickFacts({
  page,
  element,
  instance,
  partition,
  answers,
  setPage,
}: {
  page: SpacePage;
  element: Element | null;
  instance: SceneInstance | null;
  /** The pick's source kind, as the scene stamp names it. */
  partition: string | null;
  answers: SpaceAnswers;
  setPage: (patch: Partial<SpacePage>) => void;
}) {
  const observation = useNativeObservation();
  const row = answers.rows && page.row !== null ? rowAt(answers.rows.response, page.row) : null;
  let target: ElementTarget | null = null;
  let facts: ReactNode = null;
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
        <Fact name="geometry">
          {element.representation === "oriented-box"
            ? element.orientedBox?.frame === "triangles"
              ? "triangle envelope"
              : "symbol bounds"
            : element.representation === "run"
              ? "straight run"
              : "captured surfaces"}
        </Fact>
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
        <VisibilityControls page={page} setPage={setPage} />
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
      <KitLegend
        label={encoding}
        says={ENCODING_SAYS[encoding]}
        rows={legend.map((entry, index) => ({
          key: entry.value,
          word: legendWord(
            !entry.value.trim() ||
              /[.!?](?:\s|$)/.test(entry.value) ||
              entry.value.trim().split(/\s+/).length > 4
              ? `${encoding} ${index + 1}`
              : entry.value,
          ),
          says: entry.value,
          count: entry.count,
          stroke: { ink: tokenRef(entry.role), width: 1, shape: "box", fill: tokenRef(entry.role) },
        }))}
      />
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
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center gap-1 t-small">
      {label}
      <span className={width}>
        <Input
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
      </span>
    </label>
  );
}

/** One form per answer layer that is on; each press runs that layer's verb. */
export function AnswerForms({
  on,
  page,
  answers,
  setPage,
  verbs,
}: {
  on: ReadonlySet<SpaceLayer>;
  page: SpacePage;
  answers: SpaceAnswers;
  setPage: (patch: Partial<SpacePage>) => void;
  verbs: (row: { verb: string; input?: unknown }) => ReactNode;
}) {
  const band = { z0: String(page.sliceInput.z0), z1: String(page.sliceInput.z1) };
  const tree = { source: String(page.treeInput.source), depth: String(page.treeInput.maxDepth) };
  const at = page.probeInput.at.join(",");
  const path = {
    polyline: page.sweepInput.polyline.map((v) => v.join(",")).join("; "),
    width: String(page.sweepInput.widthFt),
    height: String(page.sweepInput.heightFt),
    clearance: String(page.sweepInput.clearanceFt),
  };
  const setBand = (next: typeof band) =>
    setPage({ sliceInput: { z0: num(next.z0), z1: num(next.z1) } });
  const setTree = (next: typeof tree) =>
    setPage({ treeInput: { source: num(next.source), maxDepth: num(next.depth) } });
  const setAt = (next: string) =>
    setPage({ probeInput: { at: triple(next) as [number, number, number] } });
  const setPath = (next: typeof path) =>
    setPage({
      sweepInput: {
        polyline: next.polyline.split(";").map(triple) as [number, number, number][],
        widthFt: num(next.width),
        heightFt: num(next.height),
        clearanceFt: num(next.clearance),
      },
    });
  const run = (verb: string, input?: unknown) => verbs({ verb, input });
  const says = (text: string | null) =>
    text ? <span className="t-small text-ink-2">{text}</span> : null;
  const s = answers.status?.response;
  const rows = answers.rows?.response;
  const sl = answers.slice?.response;
  const pr = answers.probe?.response;
  const sw = answers.sweep?.response;
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
          {says(answers.tree ? `${answers.tree.response.nodes.length} nodes` : null)}
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
