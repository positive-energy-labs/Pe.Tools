import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { RouteShell, defineRoute } from "#/route";
import { captureScene } from "./host";
import { spaceViewSchema } from "@pe/agent-contracts/space-view";
import { hostFetch } from "#/host/runtime";
import { SpaceCanvas } from "./canvas";
import {
  decodeScene,
  cutPolygon,
  elementKey,
  initialView,
  type Metadata,
  type ViewState,
} from "./state";

const manifest = defineRoute({
  key: "space",
  name: "Space",
  views: [{ key: "3d", label: "3D", draws: () => <SpaceRoute /> }],
  docs: "Real resident Space triangles in host internal feet. Capture once, then orbit, select, hide, isolate and cut locally. Draw a straight cut with two plan points. A bent cut is an editable plan polyline: finish it open to extend its ends to the scope edge and keep its left side, or click its first point to close a polygon and keep the inside. Drag its square handles to edit, offset it in feet, and Reverse side to keep the other side. Import/export JSON shares the exact view state with an agent.",
});
type SceneData = { metadata: Metadata; positions: Float32Array };

export function SpaceRoute({
  scene: sceneId,
  session,
  doc,
  ids: initialIds,
}: { scene?: string; session?: string; doc?: string; ids?: string } = {}) {
  const [data, setData] = useState<SceneData | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [ids, setIds] = useState(initialIds ?? "");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<"straight" | "bent" | null>(null);
  const [axis, setAxis] = useState<0 | 1 | 2>(2);
  const [editor, setEditor] = useState(false);
  const [json, setJson] = useState("");
  const loadGeneration = useRef(0);
  const change = useCallback(
    (patch: Partial<ViewState>) => {
      if (!view || !data) return false;
      if (patch.polyline || patch.closed !== undefined || patch.offset !== undefined) {
        try {
          cutPolygon({ ...view, ...patch }, data.metadata.bounds);
        } catch (e) {
          setError(String(e));
          return false;
        }
      }
      setError(null);
      setView((v) => v && { ...v, ...patch });
      return true;
    },
    [data, view],
  );
  const load = useCallback(async (id: string, imported?: ViewState) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Scene id must be a SHA-256 artifact id");
    const generation = ++loadGeneration.current;
    // The durable artifact is already cached on disk; large Chrome cache writes can fail independently.
    const response = await hostFetch(`/pe/space/scenes/${id}/artifact`, { cache: "no-store" });
    if (!response.ok)
      throw Error(
        `Scene artifact unavailable (${response.status}). Capture it from its document again.`,
      );
    const loaded = decodeScene(await response.arrayBuffer());
    if (generation !== loadGeneration.current) return;
    let restored = imported;
    if (!restored) {
      try {
        const saved = localStorage.getItem(`pe.space.view.${id}`);
        const parsed = saved ? spaceViewSchema.safeParse(JSON.parse(saved)) : null;
        if (parsed?.success && parsed.data.scene === id) restored = parsed.data;
      } catch {
        // A corrupt or unavailable local cache must not prevent opening the durable scene.
      }
    }
    if (restored) cutPolygon(restored, loaded.metadata.bounds);
    setData(loaded);
    setView(restored ?? initialView(loaded.metadata, id));
    setDrawing(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("scene", id);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  useEffect(() => {
    if (!view) return;
    try {
      localStorage.setItem(
        `pe.space.view.${view.scene}`,
        JSON.stringify(spaceViewSchema.parse(view)),
      );
    } catch {
      setError("View could not be saved in this browser. Export View JSON before reloading.");
    }
  }, [view]);
  useEffect(() => {
    if (sceneId) {
      startTransition(async () => {
        try {
          await load(sceneId);
        } catch (e) {
          setError(String(e));
        }
      });
    }
    return () => {
      loadGeneration.current++;
    };
  }, [sceneId, load]);
  const capture = async () => {
    setError(null);
    try {
      const artifact = await captureScene(ids, { bridgeSessionId: session, openDocumentId: doc });
      await load(artifact.id);
    } catch (e) {
      setError(String(e));
    }
  };
  const plan = () => {
    if (!view || !data) return;
    const b = data.metadata.bounds,
      distance = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1) * 1.7;
    change({ camera: [view.target[0], view.target[1] - 0.0001, view.target[2] + distance] });
  };
  const draw = (mode: "straight" | "bent") => {
    plan();
    change({ polyline: [], plane: null, keepInside: true, closed: false, offset: 0 });
    setDrawing(mode);
  };
  const addPoint = (p: [number, number]) => {
    if (!view || view.polyline.length >= 56) return;
    if (drawing === "bent" && view.polyline.length >= 3 && p === view.polyline[0]) {
      if (change({ closed: true })) setDrawing(null);
      return;
    }
    const previous = view.polyline.at(-1);
    if (previous && Math.hypot(previous[0] - p[0], previous[1] - p[1]) < 0.001) return;
    const points = [...view.polyline, p];
    if (drawing === "straight" && points.length === 2) {
      const a = points[0]!,
        b = points[1]!,
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.001) return;
      const nx = -(b[1] - a[1]) / length,
        ny = (b[0] - a[0]) / length;
      change({ plane: [nx, ny, 0, -nx * a[0] - ny * a[1]], polyline: [] });
      setDrawing(null);
    } else change({ polyline: points });
  };
  const selected = data?.metadata.elements.find((e) => elementKey(e) === view?.selected);
  const bounds = data?.metadata.bounds;
  const min = bounds ? [bounds.minX, bounds.minY, bounds.minZ][axis]! : 0;
  const max = bounds ? [bounds.maxX, bounds.maxY, bounds.maxZ][axis]! : 1;
  const setPlane = (value: number) => {
    const p: [number, number, number, number] = [0, 0, 0, value];
    p[axis] = -1;
    change({ plane: p });
  };
  return (
    <RouteShell manifest={manifest}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2 hairline-b pb-2">
          <span>Host MEP ids</span>
          <div className="w-64">
            <Input
              aria-label="Host MEP element ids"
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              placeholder="Comma separated; empty = whole model"
            />
          </div>
          <Button label="Capture scene" busy={busy} onClick={() => startTransition(capture)}>
            Capture scene
          </Button>
          {view && (
            <>
              <Button
                label="Fit scene"
                onClick={() => {
                  if (data) {
                    const fitted = initialView(data.metadata, view.scene);
                    change({ camera: fitted.camera, target: fitted.target });
                  }
                }}
              >
                Fit
              </Button>
              <Button label="Plan view" onClick={plan}>
                Plan
              </Button>
              <Button
                label="Hide selected"
                refusal={!selected ? "Select an element" : null}
                onClick={() =>
                  change({ hidden: [...new Set([...view.hidden, view.selected!])], selected: null })
                }
              >
                Hide
              </Button>
              <Button
                label="Isolate selected"
                refusal={!selected ? "Select an element" : null}
                onClick={() =>
                  change({
                    isolated: [view.selected!],
                    hidden: view.hidden.filter((key) => key !== view.selected),
                  })
                }
              >
                Isolate
              </Button>
              <Button label="Show all" onClick={() => change({ hidden: [], isolated: null })}>
                Show all
              </Button>
              <Button
                label="View state JSON"
                pressed={editor}
                onClick={() => {
                  setJson(JSON.stringify(view, null, 2));
                  setEditor(!editor);
                }}
              >
                View JSON
              </Button>
            </>
          )}
          {!view && (
            <Button label="Import view JSON" onClick={() => setEditor(!editor)}>
              Import view JSON
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" data-tone="alarm">
            {error}
          </p>
        )}
        {view && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              label="Draw straight cut"
              pressed={drawing === "straight"}
              onClick={() => draw("straight")}
            >
              Straight cut
            </Button>
            <Button label="Draw bent cut" pressed={drawing === "bent"} onClick={() => draw("bent")}>
              Bent cut
            </Button>
            {drawing === "bent" && (
              <>
                <Button
                  label="Undo last point"
                  refusal={view.polyline.length === 0 ? "No points placed" : null}
                  onClick={() => change({ polyline: view.polyline.slice(0, -1) })}
                >
                  Undo point
                </Button>
                <Button
                  label="Finish open cut"
                  refusal={view.polyline.length < 2 ? "Place at least two points" : null}
                  onClick={() => setDrawing(null)}
                >
                  Finish open
                </Button>
              </>
            )}
            {drawing === "straight" && (
              <Button label="Cancel straight cut" onClick={() => setDrawing(null)}>
                Cancel
              </Button>
            )}
            {drawing !== "straight" && view.polyline.length >= 2 && (
              <>
                <Button
                  label={view.closed ? "Reopen polygon" : "Close polygon"}
                  refusal={
                    !view.closed && view.polyline.length < 3 ? "Place at least three points" : null
                  }
                  onClick={() => {
                    if (change({ closed: !view.closed })) setDrawing(null);
                  }}
                >
                  {view.closed ? "Reopen" : "Close polygon"}
                </Button>
                {!drawing && (
                  <Button
                    label="Add points to the cut end"
                    refusal={view.polyline.length >= 56 ? "56 points maximum" : null}
                    onClick={() => {
                      if (change({ closed: false })) setDrawing("bent");
                    }}
                  >
                    Add points
                  </Button>
                )}
                <span>Offset ft</span>
                <div className="w-20">
                  <Input
                    type="number"
                    aria-label="Cut offset in feet, toward the left of the drawing direction"
                    step={0.5}
                    value={view.offset}
                    onChange={(e) => {
                      const offset = Number(e.target.value);
                      if (e.target.value !== "" && Number.isFinite(offset)) change({ offset });
                    }}
                  />
                </div>
              </>
            )}
            <Button
              label="Reverse retained side"
              onClick={() =>
                change({
                  plane: view.plane
                    ? (view.plane.map((n) => -n) as NonNullable<ViewState["plane"]>)
                    : null,
                  keepInside: !view.keepInside,
                })
              }
            >
              Reverse side
            </Button>
            <Button
              label="Clear cuts"
              onClick={() => {
                change({ plane: null, polyline: [], closed: false, offset: 0 });
                setDrawing(null);
              }}
            >
              Clear cuts
            </Button>
            {([0, 1, 2] as const).map((a) => (
              <Button
                key={a}
                label={`Cut ${["X", "Y", "Z"][a]}`}
                pressed={axis === a}
                onClick={() => {
                  setAxis(a);
                  const b = data!.metadata.bounds;
                  const p: [number, number, number, number] = [
                    0,
                    0,
                    0,
                    [b.maxX, b.maxY, b.maxZ][a]!,
                  ];
                  p[a] = -1;
                  change({ plane: p });
                }}
              >
                {["X", "Y", "Z"][a]}
              </Button>
            ))}
            <div className="w-48">
              <Input
                type="range"
                aria-label="Section plane position in feet"
                min={min}
                max={max}
                step={(max - min) / 1000}
                value={view.plane?.[axis] === -1 ? view.plane[3] : max}
                onChange={(e) => setPlane(Number(e.target.value))}
              />
            </div>
            <span>
              {drawing === "straight"
                ? "Click two points; the left side is kept."
                : drawing === "bent"
                  ? `Click to add points (${view.polyline.length}/56). Click the first point to close a polygon, or Finish open to extend both ends to the scope edge. A red line crosses itself and is not applied.`
                  : view.polyline.length >= 2
                    ? `Drag square handles to edit the ${view.closed ? "polygon" : "open cut"}${view.offset ? "; the blue line is the cut shifted by the offset" : ""}. ${view.closed ? (view.keepInside ? "Inside" : "Outside") : view.keepInside ? "The left side" : "The right side"} is kept.`
                    : "Left drag orbit · right drag pan · wheel zoom · click select."}
            </span>
          </div>
        )}
        {editor && (
          <div className="flex flex-col gap-2">
            <textarea
              aria-label="Serializable Space view state JSON"
              className="w-full min-h-32 face-mono"
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                label="Apply view JSON"
                onClick={() => {
                  try {
                    const imported = spaceViewSchema.parse(JSON.parse(json));
                    if (view?.scene === imported.scene) {
                      cutPolygon(imported, data!.metadata.bounds);
                      setView(imported);
                      setDrawing(null);
                      setError(null);
                    } else {
                      startTransition(async () => {
                        try {
                          await load(imported.scene, imported);
                        } catch (e) {
                          setError(String(e));
                        }
                      });
                    }
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Apply JSON
              </Button>
              <Button
                label="Refresh view JSON"
                onClick={() => setJson(JSON.stringify(view, null, 2))}
              >
                Refresh JSON
              </Button>
            </div>
          </div>
        )}
        {data && view ? (
          <>
            <div className="relative min-h-64 flex-1" data-surface="recess">
              <SpaceCanvas
                metadata={data.metadata}
                positions={data.positions}
                state={view}
                drawing={drawing}
                onDraw={addPoint}
                onChange={change}
                onError={setError}
              />
            </div>
            <div className="flex flex-wrap gap-x-4 hairline-t pt-1">
              <span>
                {data.metadata.triangles.toLocaleString()} triangles ·{" "}
                {data.metadata.elements.length.toLocaleString()} elements ·{" "}
                {data.metadata.omittedElements} omitted at budget
              </span>
              <span>
                Captured {data.metadata.stamp.builtUtc} · epoch {data.metadata.stamp.epoch} ·{" "}
                {data.metadata.stamp.fresh ? "fresh at capture" : "stale at capture"} · host
                internal ft
              </span>
              <a href={`?scene=${view.scene}`}>Saved scene</a>
            </div>
            <p className="face-mono">
              {selected
                ? `${selected.handle.category} · element ${selected.handle.elementId} · link ${selected.handle.linkInstanceId ?? "host"} · ${selected.handle.uniqueId} · document ${selected.handle.documentKey}`
                : "No element selected"}
            </p>
          </>
        ) : (
          <p>
            {busy
              ? "Reading real Space mesh…"
              : "Capture the active document, or import a view JSON referencing a saved scene. Use host MEP ids to include only their surrounding context."}
          </p>
        )}
      </div>
    </RouteShell>
  );
}
