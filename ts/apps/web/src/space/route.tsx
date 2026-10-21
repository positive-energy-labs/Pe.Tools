import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useScopeKeys } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { RouteShell, defineRoute } from "#/route";
import { captureScene } from "./host";
import { spaceViewSchema } from "@pe/agent-contracts/space-view";
import { hostFetch } from "#/host/runtime";
import { type CutMenu } from "./canvas";
import { SpaceViewer } from "./viewer";
import { SceneCache, type SceneData, type ResidentScene } from "./scene-cache";
import { spaceMark } from "./performance";
import {
  AXES,
  AXIS_LABEL,
  cutPolygons,
  decodeScene,
  deleteNode,
  elementKey,
  emptyCut,
  frameRect,
  initialView,
  insertNode,
  seedCut,
  type Axis,
  type Cut,
  type ViewState,
} from "./state";

const manifest = defineRoute({
  key: "space",
  name: "Space",
  views: [{ key: "3d", label: "3D", draws: () => <SpaceRoute /> }],
  docs: "Real resident Space triangles in host internal feet. Capture once, then orbit, select, hide, isolate and cut locally. Three cuts, one per axis (Top, North, East), each a polyline extruded through the scene; the view keeps their intersection. Click a corner floater to edit that axis orthographically; Esc returns to the saved 3D camera. Drag node or edge grips in 3D or the editor: an edge folds along its neighbours and collapses to their corner when pushed past it; a node dropped on its neighbour merges. Right click an edge to add a node, a node to delete it. Open cuts keep two nodes and extend to the scope edge keeping their left side; closed cuts keep three and keep their inside. Import/export JSON shares the exact view state with an agent.",
});
export function SpaceRoute({
  scene: sceneId,
  session,
  doc,
  ids: initialIds,
}: { scene?: string; session?: string; doc?: string; ids?: string } = {}) {
  const [data, setData] = useState<SceneData | null>(null);
  const cache = useRef(new SceneCache());
  const [scenes, setScenes] = useState<ResidentScene[]>([]);
  const [artifactId, setArtifactId] = useState(sceneId ?? "");
  const loading = useRef<AbortController | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [ids, setIds] = useState(initialIds ?? "");
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Transient: which axis editor holds the main picture, which axis the cut controls act on.
  const [editing, setEditing] = useState<Axis | null>(null);
  const [axis, setAxis] = useState<Axis>("top");
  const [menu, setMenu] = useState<CutMenu | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState(false);
  const [json, setJson] = useState("");
  const loadGeneration = useRef(0);
  const loadedId = useRef<string | null>(null);
  const change = useCallback(
    (patch: Partial<ViewState>) => {
      if (!view || !data) return false;
      if (patch.cuts) {
        try {
          cutPolygons(patch.cuts, data.metadata.bounds);
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
    spaceMark("selection", { id, generation });
    loading.current?.abort();
    const abort = new AbortController();
    loading.current = abort;
    let loaded: SceneData | undefined = cache.current.get(id);
    spaceMark("cache", { id, hit: !!loaded });
    if (!loaded) {
      try {
        // Disk artifacts are durable. Browser HTTP cache and mounted GPU scopes are separate layers.
        const response = await hostFetch(`/pe/space/scenes/${id}/artifact`, {
          cache: "no-store",
          signal: abort.signal,
        });
        if (generation !== loadGeneration.current) return;
        spaceMark("headers", { id });
        if (!response.ok)
          throw Error(
            `Scene artifact unavailable (${response.status}). Capture it from its document again.`,
          );
        const buffer = await response.arrayBuffer();
        if (generation !== loadGeneration.current) return;
        spaceMark("body", { id, bytes: buffer.byteLength });
        const decoded = decodeScene(buffer);
        spaceMark("decode", { id });
        loaded = decoded;
      } catch (e) {
        if (abort.signal.aborted || generation !== loadGeneration.current) return;
        throw e;
      }
    }
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
    if (restored) cutPolygons(restored.cuts, loaded.metadata.bounds);
    if (!cache.current.entries.has(id)) loaded = cache.current.put(id, loaded);
    setData(loaded);
    loadedId.current = id;
    // LRU order must not move mounted canvases: React StrictMode reconnects effects on moves.
    setScenes((previous) => {
      const next = previous.filter((entry) => cache.current.entries.get(entry.id) === entry);
      for (const entry of cache.current.entries.values())
        if (!next.includes(entry)) next.push(entry);
      return next.length === previous.length && next.every((entry, i) => entry === previous[i])
        ? previous
        : next;
    });
    setArtifactId(id);
    spaceMark("resident", { id, count: cache.current.entries.size, bytes: cache.current.bytes });
    setView(restored ?? initialView(loaded.metadata, id));
    setEditing(null);
    setMenu(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("scene", id);
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const open = (id: string, imported?: ViewState) => {
    const read = async () => {
      try {
        await load(id, imported);
      } catch (e) {
        setError(String(e));
      }
    };
    // A resident scope has no I/O. Its selection is urgent, not background transition work.
    if (cache.current.entries.has(id)) void read();
    else startTransition(read);
  };
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
    if (sceneId && loadedId.current !== sceneId) {
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
      loading.current?.abort();
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
  const setCut = (target: Axis, next: Cut | null) => {
    if (!view) return false;
    setAxis(target);
    return change({ cuts: { ...view.cuts, [target]: next ?? emptyCut } });
  };
  const edit = (target: Axis | null) => {
    setMenu(null);
    setEditing(target);
    if (target) setAxis(target);
  };
  useScopeKeys([
    {
      hotkey: "Escape",
      label: "return to 3D",
      says: "Leave the axis editor and return to the saved 3D camera",
      available: () => editing !== null && menu === null,
      callback: () => edit(null),
    },
  ]);
  const active = view?.cuts[axis];
  const menuCut = menu && view?.cuts[menu.axis];
  type MenuAction = {
    key: string;
    label: string;
    refusal: string | null;
    run: () => Cut | null | string;
  };
  const menuActions: MenuAction[] = [];
  if (menu && menuCut && menu.kind === "edge")
    menuActions.push({
      key: "add",
      label: "Add node",
      refusal: null,
      run: () => insertNode(menuCut, menu.index, menu.point),
    });
  if (menu && menuCut && menu.kind === "node") {
    const result = deleteNode(menuCut, menu.index);
    menuActions.push({
      key: "delete",
      label: result === null ? "Delete node (clears the cut)" : "Delete node",
      refusal: typeof result === "string" ? result : null,
      run: () => result,
    });
  }
  const selected = data?.metadata.elements.find((e) => elementKey(e) === view?.selected);
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
          <div className="w-64">
            <Input
              aria-label="Saved scene artifact id"
              value={artifactId}
              onChange={(e) => setArtifactId(e.target.value)}
              placeholder="Saved scene SHA-256"
            />
          </div>
          <Button label="Open saved scene" onClick={() => open(artifactId.trim())}>
            Open saved scene
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
        {view && active && (
          <div className="flex flex-wrap items-center gap-2">
            {AXES.map((a) => (
              <Button
                key={a}
                label={`${AXIS_LABEL[a]} cut controls`}
                pressed={axis === a}
                onClick={() => setAxis(a)}
              >
                {AXIS_LABEL[a]}
              </Button>
            ))}
            {active.polyline.length === 0 ? (
              <>
                <Button
                  label={`Add a ${AXIS_LABEL[axis]} section line`}
                  onClick={() =>
                    setCut(axis, seedCut(frameRect(axis, data!.metadata.bounds), "line"))
                  }
                >
                  Add line
                </Button>
                <Button
                  label={`Add a ${AXIS_LABEL[axis]} box`}
                  onClick={() =>
                    setCut(axis, seedCut(frameRect(axis, data!.metadata.bounds), "box"))
                  }
                >
                  Add box
                </Button>
              </>
            ) : (
              <>
                <Button
                  label={active.closed ? "Reopen polygon" : "Close polygon"}
                  refusal={
                    !active.closed && active.polyline.length < 3 ? "Add a third node first" : null
                  }
                  onClick={() => setCut(axis, { ...active, closed: !active.closed })}
                >
                  {active.closed ? "Reopen" : "Close polygon"}
                </Button>
                <span>Offset ft</span>
                <div className="w-20">
                  <Input
                    type="number"
                    aria-label="Cut offset in feet, toward the left of the drawing direction"
                    step={0.5}
                    value={active.offset}
                    onChange={(e) => {
                      const offset = Number(e.target.value);
                      if (e.target.value !== "" && Number.isFinite(offset))
                        setCut(axis, { ...active, offset });
                    }}
                  />
                </div>
                <Button
                  label="Reverse retained side"
                  onClick={() => setCut(axis, { ...active, keepInside: !active.keepInside })}
                >
                  Reverse side
                </Button>
                <Button
                  label={`Clear the ${AXIS_LABEL[axis]} cut`}
                  onClick={() => setCut(axis, null)}
                >
                  Clear
                </Button>
              </>
            )}
            <span>
              {active.polyline.length === 0
                ? `No ${AXIS_LABEL[axis]} cut: nothing is clipped on this axis. Add a line or box, then drag it.`
                : `${active.closed ? (active.keepInside ? "Inside" : "Outside") : active.keepInside ? "Left side" : "Right side"} kept. Drag grips: an edge folds along its neighbours and collapses to their corner when pushed past it; drop a node on a neighbour to merge. Open keeps 2 nodes (removing the last edge clears the cut), closed keeps 3.`}
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
                      cutPolygons(imported.cuts, data!.metadata.bounds);
                      setView(imported);
                      setEditing(null);
                      setError(null);
                    } else {
                      open(imported.scene, imported);
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
              <SpaceViewer
                scenes={scenes}
                state={view}
                editing={editing}
                onEdit={edit}
                onCut={setCut}
                onChange={change}
                onMenu={setMenu}
                onError={setError}
              />
              {menu && (
                <div
                  ref={setAnchor}
                  className="pointer-events-none absolute size-px"
                  style={{ left: menu.x, top: menu.y }}
                />
              )}
              {menu && anchor && (
                <ListPopup<MenuAction>
                  anchor="caret"
                  purpose="menu"
                  caret={anchor}
                  open
                  onOpenChange={(next) => {
                    if (!next) setMenu(null);
                  }}
                  aria-label={`${AXIS_LABEL[menu.axis]} cut ${menu.kind} actions`}
                  items={menuActions}
                  keyOf={(item) => item.key}
                  labelOf={(item) => item.label}
                  filter="none"
                  select="single"
                  empty="no actions"
                  row={(item) => ({ label: item.label, refusal: item.refusal })}
                  onPick={(item) => {
                    const result = item.run();
                    setMenu(null);
                    if (typeof result === "string") setError(result);
                    else setCut(menu.axis, result);
                  }}
                />
              )}
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
