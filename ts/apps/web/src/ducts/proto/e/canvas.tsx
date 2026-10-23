/**
 * The picture pane: one `Pane` whose strip holds the picture mode (model or schematic, `S` swaps),
 * the layers, and two floaters, the orbit globe (`G`) and the other picture small (a click swaps).
 * The model is the subject system's real meshes (`model-picture.tsx`) with its annotations; the
 * schematic is the one-line. Element facts open beside its projected box; rulings open at the pointer. A pick, a
 * frame, a look and a gesture each write only their own Page keys.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { DUCTS_LAYERS, toggleLayer } from "@pe/agent-contracts";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { noRunBranches } from "@pe/ducts-domain/no-runs";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { ChevronRight } from "lucide-react";
import { SelectionBoxButton } from "#/revit/element-menu";
import { observedElements } from "#/revit/observation";
import { KeyLegend } from "#/components/lang/kbd";
import { Pane } from "#/components/lang/pane";
import { useNativeObservation } from "#/revit/observation";
import { useScene } from "#/scene/use-scene";
import { useLiveOrbit } from "#/scene/live-orbit";
import { boundsOfInstances } from "#/scene/orbit";
import { viewportProject } from "#/scene/projection";

import type { Ruling } from "../../annotations";
import { elementNamer } from "../../claims";
import { PICTURE_KEYS } from "../../docs";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { labelOfNode, legsOf } from "../../legs";
import { sceneRequestOf } from "../../manifest";
import { findingLayers, findingShapes } from "../../finding-layers";
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
  | { what: "element"; id: number; x: number; y: number; box: DOMRect; side: "left" | "right" }
  | { what: "ruling"; n: number; x: number; y: number }
  | null;

const LAYER_WORDS: Record<
  (typeof DUCTS_LAYERS)[number],
  { label: string; chord?: "M" | "C" | "L" }
> = {
  meshes: { label: "meshes", chord: "M" },
  context: { label: "context", chord: "C" },
  centrelines: { label: "centrelines", chord: "L" },
  "no-run": { label: "branches with no run" },
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
  /** An element's name the way the sidebar reads it (grille labels first). */
  nameOf: (id: number) => string;
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
  nameOf,
  setPage,
  onPose,
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
  const committedPose = useMemo(() => poseOf(page.viewport, bounds), [page.viewport, bounds]);
  const pose = committedPose;
  const orbit = useLiveOrbit(
    committedPose,
    (viewport, how) => setPage({ viewport }, { history: how === "gesture" ? "replace" : "push" }),
    `${native?.session}/${native?.openId}/${page.system}/${page.picture}`,
    page.viewport,
  );
  // Pea reads the committed pose (`facts.pose`), not the in-progress globe preview.
  useEffect(() => {
    onPose?.(committedPose);
  }, [committedPose, onPose]);
  const layers = new Set<string>(page.layers);
  const picture = page.picture;
  const swap = () =>
    setPage({ picture: picture === "model" ? "schematic" : "model" }, { history: "push" });

  const sub = scene.subject ?? null;
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const pointer = useRef({ x: 0, y: 0 });
  const [pictureHost, setPictureHost] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const selectionFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(selectionFrame.current), []);
  useLayoutEffect(() => {
    if (open?.what !== "element") return;
    // Start after the popup mounts. Scheduling from the click starts one frame too early:
    // the router's synchronous selection render would still block its first visible frame.
    cancelAnimationFrame(selectionFrame.current);
    selectionFrame.current = requestAnimationFrame(() => {
      selectionFrame.current = requestAnimationFrame(() => {
        selectionFrame.current = 0;
        setPage({ selected: String(open.id) }, { history: "push" });
      });
    });
  }, [open, setPage]);
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

  const noRuns = useMemo<ReturnType<typeof noRunBranches>>(
    () =>
      priced && page.system
        ? noRunBranches(
            priced.snapshot,
            priced.next,
            systemScope(priced.snapshot, page.system),
            priced.flows,
          )
        : new Map(),
    [priced, page.system],
  );
  const findings3d = useMemo(
    () =>
      findingLayers(
        findingShapes(
          snapshot,
          annotated,
          work.doc,
          page.system ? systemScope(snapshot, page.system).members : undefined,
        ),
      ),
    [snapshot, annotated, work.doc, page.system],
  );

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

  // Opening facts is local and urgent. Updating the address also renders the tree and rules;
  // let that work follow the first paint instead of holding the popover behind it.
  const pick = (id: number | null, at = pointer.current) => {
    const host = pictureHost?.querySelector("[data-model-picture]");
    const rect = host?.getBoundingClientRect();
    const now = orbit.read();
    const b =
      id != null && read.meshes ? boundsOfInstances(read.meshes, (i) => i.revitId === id) : null;
    const project = now && bounds && rect ? viewportProject(now, bounds.scene, rect) : null;
    const points =
      b && project
        ? [b.minX, b.maxX].flatMap((x) =>
            [b.minY, b.maxY].flatMap((y) =>
              [b.minZ, b.maxZ].flatMap((z) => {
                const p = project([x, y, z]);
                return p ? [p] : [];
              }),
            ),
          )
        : [];
    const xs = points.map((p) => p[0] + rect!.left);
    const ys = points.map((p) => p[1] + rect!.top);
    const box = points.length
      ? DOMRect.fromRect({
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        })
      : DOMRect.fromRect({ ...at, width: 0, height: 0 });
    setOpen(
      id == null
        ? null
        : {
            what: "element",
            id,
            ...at,
            box,
            side: box.left > window.innerWidth - box.right ? "left" : "right",
          },
    );
    if (id == null) {
      cancelAnimationFrame(selectionFrame.current);
      setPage({ selected: "" }, { history: "push" });
    }
  };
  useEffect(() => {
    if (!page.selected) setOpen(null);
  }, [page.selected]);
  const ruling = (r: Ruling, at: { x: number; y: number }) => {
    cancelAnimationFrame(selectionFrame.current);
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
    orbit,
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
          open.what === "element"
            ? open.box
            : DOMRect.fromRect({ x: open.x, y: open.y, width: 0, height: 0 }),
      }
    : undefined;

  // The title is a breadcrumb: the system (press to clear the selection), then the picked element.
  const pickedId =
    page.selected && /^\d+$/.test(page.selected) && !claims.some((c) => c.id === page.selected)
      ? Number(page.selected)
      : null;
  const pickedName = pickedId == null ? null : nameOf(pickedId);
  const title =
    systemName == null ? (
      "picture"
    ) : pickedName == null ? (
      <span className="block truncate" title={systemName}>
        {systemName}
      </span>
    ) : (
      <span className="flex min-w-0 items-center gap-0.5" data-e-crumb="">
        <TooltipHint content={`${systemName} · clear the selection`}>
          <button
            type="button"
            className="min-w-0 shrink truncate"
            aria-label={`clear the selection in ${systemName}`}
            onClick={() => setPage({ selected: "" }, { history: "push" })}
          >
            {systemName}
          </button>
        </TooltipHint>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-2" />
        <span
          className="min-w-0 truncate"
          title={pickedName}
          data-e-selected={pickedId ?? undefined}
        >
          {pickedName}
        </span>
      </span>
    );

  return (
    <Pane
      id="e-picture"
      title={title}
      scroll="clip"
      flush
      actions={
        <span className="inline-flex items-center gap-1">
          {pickedId != null ? (
            <SelectionBoxButton target={observedElements(observation, [pickedId])} />
          ) : null}
          <EncodingPicker value={scale.encoding.key} onPick={(key) => setPage({ encoding: key })} />
        </span>
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
        value: page.layers,
        options: DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] })),
        onToggle: (key) =>
          setPage(
            {
              layers: toggleLayer(DUCTS_LAYERS, page.layers, key as (typeof DUCTS_LAYERS)[number]),
            },
            { history: "push" },
          ),
      }}
      floaters={floaters}
    >
      <div
        ref={setPictureHost}
        data-proto="E"
        className="relative flex size-full min-h-0 flex-col"
        onPointerDownCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onPointerMoveCapture={(e) => {
          if (
            open &&
            e.buttons &&
            Math.hypot(e.clientX - pointer.current.x, e.clientY - pointer.current.y) > 5
          )
            setOpen(null);
        }}
        onWheelCapture={() => {
          if (open) setOpen(null);
        }}
        onDoubleClickCapture={() => setOpen(null)}
      >
        {picture === "model" ? (
          <ModelPicture
            read={read}
            bounds={bounds}
            orbit={orbit}
            wheelHost={pictureHost?.closest<HTMLElement>("[data-slot='pane-field']")}
            scene={scene}
            layers={layers}
            encoding={scale.encoding}
            selected={selected}
            lit={litAll}
            hovered={hovered}
            labels={labels}
            rulings={rulings}
            findings3d={findings3d}
            noRuns={noRuns}
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
            <span className="face-mono">
              {solved
                ? solved.fan == null
                  ? "needs a fix: implausible loss"
                  : `${fmt(solved.fan, 4)} in-wg`
                : "unpriced"}
            </span>{" "}
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

        <Popover
          open={!!open}
          onOpenChange={(o, details) => {
            if (o) return;
            setOpen(null);
            if (details.reason === "escape-key") {
              cancelAnimationFrame(selectionFrame.current);
              setPage({ selected: "" }, { history: "push" });
            }
          }}
        >
          <PopoverContent
            anchor={anchor}
            side={open?.what === "element" ? open.side : "bottom"}
            collisionAvoidance={{ side: "none", align: "shift" }}
            initialFocus={false}
            finalFocus={false}
            data-proto-c-popover={open?.what ?? ""}
          >
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
                {noRuns.has(elementId) ? (
                  <p>
                    No run:{" "}
                    {noRuns
                      .get(elementId)!
                      .reasons.map((r) => r.text)
                      .join("; ")}
                  </p>
                ) : null}
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
