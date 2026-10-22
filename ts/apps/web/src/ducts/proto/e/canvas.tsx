/**
 * The picture pane: one `Pane` whose strip holds the picture mode (model or schematic, `S` swaps),
 * the layers, and two floaters, the orbit globe (`G`) and the other picture small (a click swaps).
 * The model is the subject system's real meshes (`model-picture.tsx`) with its annotations; the
 * schematic is the one-line. Facts and rulings open in popovers where the pointer was. A pick, a
 * frame, a look and a gesture each write only their own Page keys.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { DUCTS_LAYERS } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { KeyLegend } from "#/components/lang/kbd";
import { Pane } from "#/components/lang/pane";
import { useNativeObservation } from "#/revit/observation";
import { useScene } from "#/scene/use-scene";
import type { OrbitViewport } from "#/scene/orbit";

import type { Ruling } from "../../annotations";
import { elementNamer } from "../../claims";
import { PICTURE_KEYS } from "../../docs";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { flipLayer, layersOn, sceneRequestOf } from "../../manifest";
import { ModelPicture, poseOf, usePictureBounds } from "../../model-picture";
import { ProvisionalNote } from "../../provisional";
import { indexOf, sceneOf, subjectScene } from "../../scene";
import { Schematic } from "../../schematic";
import { EncodingPicker } from "../encoding/picker";
import { ScaleLegend } from "../encoding/scale-legend";
import type { GroupEncoding } from "../encoding/use-encoding";
import type { ProtoProps } from "../props";
import { fmtFt } from "./bar";
import { usePictureFloaters } from "./picture-floaters";
import { RulingBody, useMarks } from "./rulings";

type Open =
  | { what: "element"; id: number; x: number; y: number }
  | { what: "ruling"; n: number; x: number; y: number }
  | null;

const LAYER_WORDS: Record<
  (typeof DUCTS_LAYERS)[number],
  { label: string; chord?: "M" | "C" | "L" }
> = {
  meshes: { label: "meshes", chord: "M" },
  context: { label: "context", chord: "C" },
  centrelines: { label: "centrelines", chord: "L" },
  labels: { label: "labels" },
  findings: { label: "findings" },
};
const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

export interface ECanvasExtra {
  /** The element set a sidebar row lights; empty lights nothing. */
  lit: ReadonlySet<number>;
  /** The system's groups (stable, `systemScope`); the picture draws every one. */
  groups: readonly string[];
  /** The group whose fan the header reads: the system's largest; the schematic draws it. */
  lead: string;
  /** The system's issue ids; null = every issue on a drawn element. */
  issueScope: ReadonlySet<string> | null;
  /** The finding (and issue) ids the picture annotates (`annotatedFindings`). */
  annotated: ReadonlySet<string>;
  /** The group's encoding: the screen owns it so the tree reads the same numbers. */
  scale: GroupEncoding;
}

export function ECanvas(props: ProtoProps & ECanvasExtra) {
  const { snapshot } = props;
  if (!snapshot)
    return (
      <p className="p-3 text-ink-2">
        {props.empty?.says ?? (props.reading.pending ? "reading ducts…" : "no snapshot")}
      </p>
    );
  return <Canvas {...props} snapshot={snapshot} />;
}

function Canvas({
  snapshot,
  priced,
  page,
  subject,
  claims,
  onVerdict,
  work,
  hovered,
  onHover,
  lit,
  issueScope,
  annotated,
  groups,
  lead,
  scale,
  setPage,
}: ProtoProps & ECanvasExtra & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
  const observation = useNativeObservation();
  const index = useMemo(() => indexOf(snapshot, priced), [snapshot, priced]);
  const labelOf = useMemo(() => labelOfNode(snapshot), [snapshot]);
  const scene = useMemo(
    () =>
      subject
        ? subjectScene(
            index,
            subject.ids,
            legsOf(snapshot, subject.ids, labelOf, subject.work ?? null),
          )
        : sceneOf(index, groups, () => true),
    [index, snapshot, subject, labelOf, groups],
  );
  const native = observation.scope?.source === "native" ? observation.scope.document : null;
  const request = useMemo(
    () => sceneRequestOf(snapshot, page),
    [snapshot, page.system, page.layers],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const read = useScene(request, native, page.epoch);
  const bounds = usePictureBounds(read.meshes, scene);
  const committedPose = poseOf(page.viewport, bounds);
  const [orbitDraft, setOrbitDraft] = useState<{
    base: typeof page.viewport;
    system: string;
    pose: OrbitViewport;
  } | null>(null);
  const pose =
    orbitDraft?.base === page.viewport && orbitDraft.system === page.system
      ? orbitDraft.pose
      : committedPose;
  // The pose the picture shows is a fact Pea reads (`facts.pose`); only this effect writes it.
  useEffect(() => {
    if (JSON.stringify(committedPose) !== JSON.stringify(page.pose))
      setPage({ pose: committedPose });
  }, [committedPose, page.pose, setPage]);
  const layers = layersOn(page);
  const picture = page.picture;
  const swap = () =>
    setPage({ picture: picture === "model" ? "schematic" : "model" }, { history: "push" });

  const sub = scene.subject ?? null;
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const pointer = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState<Open>(null);
  const pointOf = (id: number): readonly number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };
  const { rulings, labels, cumulative } = useMarks({
    snapshot,
    priced,
    scene,
    claims,
    work,
    issueScope,
    annotated,
    pointOf,
  });

  // Header facts: a system name (never a group id), Pe fan static, critical run total.
  const firstId = subject?.ids[0] ?? scene.segments[0]?.segment.id ?? null;
  const systemName =
    (page.system || null) ??
    (firstId == null
      ? null
      : (byId.segments.get(firstId)?.systemName ?? byId.nodes.get(firstId)?.systemName)) ??
    null;
  const groupId =
    lead ||
    (firstId == null
      ? ""
      : (byId.segments.get(firstId)?.groupId ?? byId.nodes.get(firstId)?.groupId ?? ""));
  const solved = groupId ? priced?.next.byGroup[groupId] : null;
  const criticalName = solved?.critical != null ? nameOfId(solved.critical) : null;

  const selected = useMemo(() => {
    const id =
      page.selected && !claims.some((c) => c.id === page.selected) ? Number(page.selected) : null;
    if (id == null || !Number.isFinite(id)) return new Set<number>();
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  }, [page.selected, claims, sub]);
  const litAll = useMemo(
    () => new Set([...lit, ...(hovered == null ? [] : [hovered])]),
    [lit, hovered],
  );

  /** A pick writes the selection alone, and opens the element's facts where the pointer was. */
  const pick = (id: number | null, at = pointer.current) => {
    setPage({ selected: id == null ? "" : String(id) }, { history: "push" });
    setOpen(id == null ? null : { what: "element", id, ...at });
  };
  const ruling = (r: Ruling, at: { x: number; y: number }) => {
    setPage({ selected: String(r.at) }, { history: "push" });
    setOpen({ what: "ruling", n: r.n, ...at });
  };
  const schematic = (size: "main" | "inset") => (
    <Schematic
      index={index}
      group={lead}
      encoding={scale.encoding}
      selected={selected}
      lit={litAll}
      onSelect={(id) => pick(id)}
      onHover={onHover}
      size={size}
    />
  );

  const floaters = usePictureFloaters({
    picture,
    pose,
    bounds,
    scene,
    meshes: read.meshes,
    onOrbit: (viewport, how) => {
      if (how === "gesture")
        setOrbitDraft({ base: page.viewport, system: page.system, pose: viewport });
      else {
        setOrbitDraft(null);
        setPage({ viewport }, { history: "push" });
      }
    },
    onOrbitEnd: (viewport) => {
      setOrbitDraft(null);
      if (viewport) setPage({ viewport }, { history: "replace" });
    },
    swap,
    small: () => schematic("inset"),
  });

  const openRuling = open?.what === "ruling" ? rulings.find((r) => r.n === open.n) : null;
  const elementId = open?.what === "element" ? open.id : null;
  const segFacts =
    elementId == null ? null : scene.segments.find((f) => f.segment.id === elementId);
  const nodeFacts = elementId == null ? null : scene.nodes.find((f) => f.node.id === elementId);
  const anchor = open
    ? {
        getBoundingClientRect: () =>
          DOMRect.fromRect({ x: open.x, y: open.y, width: 0, height: 0 }),
      }
    : undefined;

  return (
    <Pane
      id="e-picture"
      title={systemName ?? "picture"}
      scroll="clip"
      flush
      actions={
        <EncodingPicker value={scale.encoding.key} onPick={(key) => setPage({ encoding: key })} />
      }
      modes={{
        label: "picture",
        value: picture,
        onChange: (key) => setPage({ picture: key as typeof picture }, { history: "push" }),
        // `S` sits on the other picture, so the one chord always swaps.
        options: (["model", "schematic"] as const).map((key) => ({
          key,
          label: key,
          chord: key === picture ? undefined : "S",
          says: `The ${key} large, the other in the corner`,
        })),
      }}
      layers={{
        value: [...layers],
        options: DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] })),
        onToggle: (key) =>
          setPage(
            { layers: flipLayer(page, key as (typeof DUCTS_LAYERS)[number]) },
            { history: "push" },
          ),
      }}
      floaters={floaters}
    >
      <div
        data-proto="E"
        className="relative flex size-full min-h-0 flex-col"
        onPointerDownCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      >
        {picture === "model" ? (
          <ModelPicture
            read={read}
            bounds={bounds}
            pose={pose}
            scene={scene}
            layers={layers}
            encoding={scale.encoding}
            selected={selected}
            lit={litAll}
            hovered={hovered}
            labels={labels}
            rulings={rulings}
            pointOf={pointOf}
            issue={page.issue}
            setPage={setPage}
            onPick={pick}
            onRuling={ruling}
            onHover={onHover}
          />
        ) : (
          schematic("main")
        )}

        <div
          className="absolute left-2 top-2 flex flex-col gap-0.5 t-small px-1.5 py-1"
          data-surface="page"
          data-proto-c-header=""
        >
          <span>
            fan static{" "}
            <span className="face-mono">{solved ? `${fmt(solved.fan, 4)} in-wg` : "unpriced"}</span>{" "}
            {solved ? (
              <ProvisionalNote provisional={solved.provisional} of="the fan static" />
            ) : null}
          </span>
          <span>
            critical run{" "}
            {solved?.critical != null ? (
              <>
                <span className="face-mono">{fmtFt(solved.criticalTel)} eq ft</span> to{" "}
                {criticalName}
              </>
            ) : (
              <span className="text-ink-2">unpriced</span>
            )}
          </span>
        </div>

        <div
          data-slot="pane-legend"
          className="absolute bottom-2 left-2 flex flex-col items-start gap-1"
        >
          <ScaleLegend
            encoding={scale.encoding}
            counts={scale.counts}
            nameOf={scale.nameOf}
            onSelect={(id) => pick(id)}
          />
          {picture === "model" ? <KeyLegend keys={PICTURE_KEYS} lead={0} /> : null}
        </div>

        <Popover open={!!open} onOpenChange={(o) => (o ? null : setOpen(null))}>
          <PopoverContent anchor={anchor} data-proto-c-popover={open?.what ?? ""}>
            {openRuling ? (
              <RulingBody
                r={openRuling}
                nameOfId={nameOfId}
                onVerdict={onVerdict}
                onHover={onHover}
                onPick={pick}
              />
            ) : elementId != null ? (
              <div className="flex flex-col gap-2">
                {segFacts ? (
                  <SegmentFactsView {...segFacts} />
                ) : nodeFacts ? (
                  <NodeFactsView {...nodeFacts} />
                ) : (
                  <p className="text-ink-2">
                    element {nameOfId(elementId) ?? elementId} is not drawn here
                  </p>
                )}
                <p data-pe-loss={elementId}>
                  Pe loss <span className="face-mono">{fmt(index.loss.get(elementId), 4)}</span>{" "}
                  in-wg · from fan{" "}
                  <span className="face-mono">{fmtFt(cumulative.get(elementId))}</span> eq ft
                  {priced ? null : (
                    <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>
                  )}
                </p>
                {sub?.legOf.get(elementId) ? <p>on leg {sub.legOf.get(elementId)!.name}</p> : null}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </Pane>
  );
}
