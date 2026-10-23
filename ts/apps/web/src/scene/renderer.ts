/**
 * The imperative core under `Scene3D`: one WebGLRenderer, one `BatchedMesh` for every element,
 * one swappable orbit camera driven by OrbitControls, and one group per answer layer. No React. Cut
 * from the space spike's canvas; the cuts themselves stay in space and reach the shader only as
 * packed polygons (`setClip`).
 *
 * The batch holds positions relative to `origin` (the bounds centre) and sits at `origin`, so the
 * camera, controls, layers and raycast hits are all world feet while float32 vertices stay small.
 *
 * An axis picture (`setPlane`) swaps in one orthographic camera that pans and zooms only; the
 * orbit pose is untouched under it. Axis thumbnails (`setThumbs`) are drawn by this same
 * context into 2D canvases, only when what they show changed, never per orbit frame.
 */
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { BEACON_LAYER, createGlow, GLOW_LAYER } from "./glow";
import { createOutline, OUTLINE_CHANNEL, OUTLINE_LAYER } from "./outline";
import {
  captureGestures,
  createWheelReader,
  pointerIntent,
  wheelPixels,
  wheelPlane,
} from "./gestures";
import { createMeshPicker } from "./picking";
import { createOrbitControls } from "./orbit-controls";
import { center, fromControls, rotateAbout, toCamera, type OrbitViewport } from "./orbit";
import { fitPlane, frameRect, fromFrame, type PlaneAxis, type PlaneViewport } from "./plane";
import {
  newCamera,
  placeCamera,
  resizeCamera,
  viewHeight,
  projectThrough,
  rayThrough,
  type Project,
  type Ray,
  type Size,
} from "./projection";
import { inkOf } from "./ink";
import { setDamageHue } from "./damage";
import type { IssueState, IssueTarget, Layer3D, SceneInstance, SceneMeshes } from "./types";

/** Opt-in timing marks (`?scenePerf`), including GPU completion rather than a bare RAF tick. */
const timing = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf");
const mark = (phase: string, detail: Record<string, unknown> = {}) => {
  if (timing()) performance.mark(`scene:${phase}`, { detail });
};

/** Up to three extruded even-odd polygons whose intersection is kept, packed two points per vec4.
 * Frames (u, v): 0 = (x, y), 1 = (-x, z), 2 = (y, z), batch-local (relative to `origin`). */
export type ClipVolume = { data: Float32Array; counts: number[]; keepInside: boolean[] };
/** Points per axis polygon the shader reads; `space/state.ts` packs its cuts against it. */
export const CLIP_POINTS = 64;

const clipping = `
varying vec3 vClipPosition;
uniform vec4 clipPolygon[${(3 * CLIP_POINTS) / 2}];
uniform int clipCount[3];
uniform int clipKeep[3];
vec2 clipPoint(int a, int i) {
  vec4 q = clipPolygon[a * ${CLIP_POINTS / 2} + i / 2];
  return (i % 2 == 0) ? q.xy : q.zw;
}
vec2 frameOf(int a, vec3 p) { return a == 0 ? p.xy : a == 1 ? vec2(-p.x, p.z) : p.yz; }
void sceneClip() {
  for (int a = 0; a < 3; a++) {
    int n = clipCount[a];
    if (n < 3) continue;
    vec2 q = frameOf(a, vClipPosition);
    bool inside = false;
    for (int i = 0; i < ${CLIP_POINTS}; i++) {
      if (i >= n) break;
      vec2 A = clipPoint(a, i), B = clipPoint(a, i == 0 ? n - 1 : i - 1);
      if ((A.y > q.y) != (B.y > q.y) && q.x < (B.x - A.x) * (q.y - A.y) / (B.y - A.y) + A.x)
        inside = !inside;
    }
    if (inside != (clipKeep[a] == 1)) discard;
  }
}`;

const MEP = /duct|pipe|conduit|tray|mechanical|plumbing|sprinkler|terminal|electrical/i;
/** The pointer within this many px of an issue mark is reaching for it (a pre-hover cue). */
const REACH_PX = 24;
/** Outlines are drawn for at most this many elements per mark; past it the fill alone carries it. */
const OUTLINED = 120;
const BOX_EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;
/** Element states, strongest last. Selection, hover and a lit row are fills and outlines in the
 * page's ink, never a hue (house law 5): the stage's one hue is damage. */
type Mark = "hover" | "lit" | "selected";
const FILL: Record<Mark, number> = { hover: 0.22, lit: 0.4, selected: 0.6 };

/** Throws when WebGL is unavailable; the component says so. */
export function createRenderer(mount: HTMLElement, meshes: SceneMeshes, wheelHost = mount) {
  const measuring = timing();
  mark("build-start", { instances: meshes.instances.length });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The Pe palette, from the page's own tokens: the picture sits on the artifact ground, focus
  // elements are a warm mid grey between the muted and secondary inks, context recedes toward the
  // ground. Mid-tone on purpose: selection and hover lift toward the ink and stay visible, and the
  // stage's only saturated colour is damage. A theme change repaints the same scene and camera.
  setDamageHue(inkOf("alarm", mount));
  const ground = inkOf("artifact", mount);
  const ink = inkOf("ink", mount);
  const focusTint = inkOf("ink-mute", mount).lerp(inkOf("ink-2", mount), 0.55);
  if (ground.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5) focusTint.lerp(ground, 0.35);
  const contextTint = inkOf("ink-mute", mount).lerp(ground, 0.5);
  renderer.setClearColor(ground);
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "3D model. Drag orbits; Shift drag, right drag or two-finger scroll pans; wheel or pinch zooms to the cursor; double-click frames. Click an element to pick it; right click or BX shows it in Revit.",
  );
  canvas.tabIndex = 0;
  canvas.className = "block size-full";
  mount.prepend(canvas);
  const glow = createGlow(renderer);
  const outline = createOutline(renderer, ink, ground);

  const bounds = meshes.bounds;
  const origin = new THREE.Vector3(...center(bounds));
  const scene = new THREE.Scene();
  // Kept under clipping: a lit face of a resting element stays below white, so a lifted (selected,
  // hovered) element is visibly lighter rather than both saturating.
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x403a30, 1.15));
  const sun = new THREE.DirectionalLight(0xfffaf2, 1.55);
  sun.position.set(1, -1, 3);
  scene.add(sun);
  let camera = newCamera();
  const controls = createOrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  // The scheme (gestures.ts): left orbits, middle and right pan, Shift+left pans (OrbitControls'
  // own modifier rule), the wheel and a pinch zoom toward the cursor.
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.zoomToCursor = true;
  // One stable picture listener also receives wheels over annotations and legends. OrbitControls'
  // canvas-only listener otherwise lets those pinches reach the browser's page zoom.
  const nativeWheel = (controls as unknown as { _onMouseWheel: (e: WheelEvent) => void })
    ._onMouseWheel;
  canvas.removeEventListener("wheel", nativeWheel);
  let orbitPivot: readonly number[] | null = null;
  let rotating = false;
  const beforeTurn = camera.quaternion.clone();
  const turnStart = (event: PointerEvent) => {
    rotating = pointerIntent(event) === "orbit";
    beforeTurn.copy(camera.quaternion);
  };
  const turnEnd = () => {
    rotating = false;
  };
  canvas.addEventListener("pointerdown", turnStart, true);
  controls.addEventListener("end", turnEnd);
  controls.addEventListener("change", () => {
    if (rotating && orbitPivot) rotateAbout(camera, controls.target, orbitPivot, beforeTurn);
    beforeTurn.copy(camera.quaternion);
  });
  // OrbitControls cancels every contextmenu, which would starve the app's element menu (it skips a
  // cancelled press). Scene3D decides instead: a right-drag pan cancels, a right click passes.
  canvas.removeEventListener(
    "contextmenu",
    (controls as unknown as { _onContextMenu: EventListener })._onContextMenu,
  );
  /** Every camera gesture, orbit or plane, as OrbitControls names them: start, change, end. */
  const moves = new THREE.EventDispatcher<Record<"start" | "change" | "end", object>>();
  for (const type of ["start", "change", "end"] as const)
    controls.addEventListener(type, () => moves.dispatchEvent({ type }));
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1);
  let plane: { axis: PlaneAxis; viewport: PlaneViewport } | null = null;
  const active = (): THREE.Camera => (plane ? ortho : camera);

  const uniforms = {
    clipPolygon: { value: new Float32Array(3 * CLIP_POINTS * 2) as Float32Array },
    clipCount: { value: [0, 0, 0] },
    clipKeep: { value: [1, 1, 1] },
  };
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vClipPosition;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvClipPosition = transformed;",
    );
    shader.fragmentShader = `${clipping}\n${shader.fragmentShader}`.replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nsceneClip();",
    );
  };
  material.customProgramCacheKey = () => "scene3d-clip-batch-v1";
  const batch = new THREE.BatchedMesh(
    meshes.instances.length,
    meshes.positions.length / 3,
    0,
    material,
  );
  // Opaque geometry needs no per-frame depth sort. Per-element visibility stays native; picking reads this same packed geometry.
  batch.sortObjects = false;
  batch.position.copy(origin);
  scene.add(batch);
  /** Batch instance id → element, and each element's resting colour. */
  const byId: SceneInstance[] = [];
  const colors: THREE.Color[] = [];
  mark("geometry-start");
  for (const instance of meshes.instances) {
    const vertices = meshes.positions.slice(
      instance.firstVertex * 3,
      (instance.firstVertex + instance.vertexCount) * 3,
    );
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i]! -= origin.x;
      vertices[i + 1]! -= origin.y;
      vertices[i + 2]! -= origin.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const id = batch.addInstance(batch.addGeometry(geometry));
    const color = (instance.focus || MEP.test(instance.category) ? focusTint : contextTint).clone();
    batch.setColorAt(id, color);
    byId[id] = instance;
    colors[id] = color;
    geometry.dispose();
  }
  mark("geometry", { meshes: byId.length, multiDraw: renderer.extensions.has("WEBGL_multi_draw") });

  let frame = 0;
  let size: Size = { width: 1, height: 1 };
  /** Told after a frame whose camera or size moved, so DOM over the canvas follows it. */
  let onFrame: ((project: Project, size: Size, ray: Ray) => void) | null = null;
  let framed = "";
  const tell = () => {
    if (!onFrame) return;
    const shown = active();
    const key = `${shown.matrixWorld.elements.join()}|${shown.projectionMatrix.elements.join()}|${size.width}x${size.height}`;
    if (key === framed) return;
    framed = key;
    onFrame(projectThrough(shown, size), size, rayThrough(shown, size));
  };
  /** The orthographic camera showing `v` over a canvas of `at`, from the frame's +w side. */
  const place = (axis: PlaneAxis, v: PlaneViewport, at: Size) => {
    const r = frameRect(axis, bounds);
    const depth = r.w1 - r.w0 + Math.max(r.u1 - r.u0, r.v1 - r.v0) + 10;
    const u = (at.width / 2 - v.tx) / v.scale,
      w = (v.ty - at.height / 2) / v.scale;
    Object.assign(ortho, {
      left: -at.width / 2,
      right: at.width / 2,
      top: at.height / 2,
      bottom: -at.height / 2,
      zoom: v.scale,
      far: depth * 3,
    });
    ortho.up.set(...fromFrame(axis, 0, 1, 0));
    ortho.position.set(...fromFrame(axis, u, w, r.w1 + depth));
    ortho.lookAt(...fromFrame(axis, u, w, r.w1));
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();
  };
  /** Thumbnails: an axis drawn at its fit; the axis shown large draws the 3D pose instead. */
  let thumbs: Partial<Record<PlaneAxis, HTMLCanvasElement | null>> = {};
  let thumbsStale = true;
  const drawThumbs = () => {
    const ratio = renderer.getPixelRatio();
    for (const axis of Object.keys(thumbs) as PlaneAxis[]) {
      const paper = thumbs[axis];
      const at = { width: paper?.clientWidth ?? 0, height: paper?.clientHeight ?? 0 };
      const ctx = paper?.getContext("2d");
      if (!paper || !ctx || !at.width || !at.height) continue;
      if (at.width > size.width || at.height > size.height) continue;
      paper.width = Math.round(at.width * ratio);
      paper.height = Math.round(at.height * ratio);
      renderer.setViewport(0, 0, at.width, at.height);
      if (plane?.axis === axis) {
        resizeCamera(camera, at.width / at.height);
        renderer.render(scene, camera);
        resizeCamera(camera, size.width / size.height);
      } else {
        place(axis, fitPlane(axis, bounds, at), at);
        renderer.render(scene, ortho);
      }
      // The drawing buffer is still this frame's: copy its bottom-left corner out before compositing.
      ctx.drawImage(
        canvas,
        0,
        canvas.height - paper.height,
        paper.width,
        paper.height,
        0,
        0,
        paper.width,
        paper.height,
      );
    }
    renderer.setViewport(0, 0, size.width, size.height);
    if (plane) place(plane.axis, plane.viewport, size);
    thumbsStale = false;
  };
  // OrbitControls fires per pointer move; coalesce those and every prop change into one frame.
  const render = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      const started = performance.now();
      if (measuring) {
        renderer.info.autoReset = false;
        renderer.info.reset();
      }
      let animate = false;
      const seconds = started / 1000;
      for (const { layer, group } of layers.values()) {
        if (!layer.frame) continue;
        const state = stateOf(layer);
        animate =
          layer.frame(group, {
            seconds,
            reducedMotion: motion.matches,
            state,
            landed: state === "focus" ? seconds - focusedAt : Infinity,
            selected: !!layer.targets?.some((t) => selectedIds.has(t.elementId)),
          }) || animate;
      }
      // Geometry is unchanged between the main, thumbnail, glow and outline passes.
      // Update transforms once, including any frame callback's changes, before all passes.
      scene.updateMatrixWorld();
      if (thumbsStale) drawThumbs();
      renderer.render(scene, active());
      if (glowing) glow.render(scene, active());
      if (outlined.children.length) outline.render(scene, active());
      if (measuring) fence(started);
      tell();
      if (animate) render();
    });
  };
  const fence = (started: number) => {
    const info = renderer.info;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    mark("submitted", {
      cpuMs: performance.now() - started,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const complete = () => {
      if (!sync || gl.isContextLost()) return;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return void requestAnimationFrame(complete);
      gl.deleteSync(sync);
      mark(status === gl.WAIT_FAILED ? "gpu-failed" : "gpu-complete", { status });
    };
    requestAnimationFrame(complete);
  };
  const resize = () => {
    if (mount.clientWidth === 0 || mount.clientHeight === 0) return;
    size = { width: mount.clientWidth, height: mount.clientHeight };
    renderer.setSize(size.width, size.height, false);
    glow.setSize(size.width, size.height);
    outline.setSize(size.width, size.height);
    fitLines(scene);
    resizeCamera(camera, size.width / size.height);
    if (plane) place(plane.axis, plane.viewport, size);
    thumbsStale = true;
    render();
  };
  controls.addEventListener("change", render);
  // The plane picture pans with any drag and zooms about the pointer; it publishes like a gesture.
  let panning: { x: number; y: number; id: number } | null = null;
  const planeDown = (event: PointerEvent) => {
    if (!plane) return;
    panning = { x: event.clientX, y: event.clientY, id: event.pointerId };
    moves.dispatchEvent({ type: "start" });
  };
  const planeMove = (event: PointerEvent) => {
    if (!plane || !panning || event.pointerId !== panning.id) return;
    const v = plane.viewport;
    plane = {
      ...plane,
      viewport: {
        ...v,
        tx: v.tx + event.clientX - panning.x,
        ty: v.ty + event.clientY - panning.y,
      },
    };
    panning = { ...panning, x: event.clientX, y: event.clientY };
    place(plane.axis, plane.viewport, size);
    render();
    moves.dispatchEvent({ type: "change" });
  };
  const planeUp = (event: PointerEvent) => {
    if (!panning || event.pointerId !== panning.id) return;
    panning = null;
    moves.dispatchEvent({ type: "end" });
  };
  const planeWheel = (event: WheelEvent) => {
    if (!plane) return;
    const rect = canvas.getBoundingClientRect();
    plane = {
      ...plane,
      viewport: wheelPlane(
        plane.viewport,
        reading(event),
        event,
        event.clientX - rect.left,
        event.clientY - rect.top,
      ),
    };
    place(plane.axis, plane.viewport, size);
    render();
    moves.dispatchEvent({ type: "start" });
    moves.dispatchEvent({ type: "end" });
  };
  canvas.addEventListener("pointerdown", planeDown);
  window.addEventListener("pointermove", planeMove);
  window.addEventListener("pointerup", planeUp);
  const reading = createWheelReader();
  const wheel = (event: WheelEvent) => {
    // An inset with its own PanZoom already consumed this event.
    if (event.defaultPrevented) return;
    event.preventDefault();
    rotating = false;
    if (plane) return planeWheel(event);
    const intent = reading(event);
    if (intent !== "scroll") return nativeWheel(event);
    const { x, y } = wheelPixels(event);
    // Content follows the fingers: fingers up (deltaY > 0) moves the camera down the screen.
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const perPx = viewHeight(camera, controls.target) / size.height;
    const move = right.multiplyScalar(x * perPx).add(up.multiplyScalar(-y * perPx));
    moves.dispatchEvent({ type: "start" });
    camera.position.add(move);
    controls.target.add(move);
    controls.update();
    moves.dispatchEvent({ type: "end" });
  };
  const releaseGestures = captureGestures(wheelHost, wheel);
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();

  const layers = new Map<string, { layer: Layer3D; group: THREE.Group }>();
  scene.matrixWorldAutoUpdate = false;
  let litIssue: string | null = null;
  let focusedIssue: string | null = null;
  let reachedIssue: string | null = null;
  /** When the focused issue became the focus (seconds, `performance.now` clock). */
  let focusedAt = -Infinity;
  const stateOf = (layer: Layer3D): IssueState => {
    const has = (key: string | null) => key !== null && !!layer.targets?.some((t) => t.key === key);
    return has(focusedIssue)
      ? "focus"
      : has(litIssue)
        ? "hover"
        : has(reachedIssue)
          ? "reach"
          : "rest";
  };
  /** True while any layer draws into the glow pass; the pass costs nothing otherwise. */
  let glowing = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", render);
  const theme = new MutationObserver(() => {
    ground.copy(inkOf("artifact", mount));
    ink.copy(inkOf("ink", mount));
    focusTint.copy(inkOf("ink-mute", mount)).lerp(inkOf("ink-2", mount), 0.55);
    if (ground.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5) focusTint.lerp(ground, 0.35);
    contextTint.copy(inkOf("ink-mute", mount)).lerp(ground, 0.5);
    renderer.setClearColor(ground);
    byId.forEach((instance, id) => {
      colors[id]!.copy(instance.focus || MEP.test(instance.category) ? focusTint : contextTint);
      batch.setColorAt(id, colors[id]!);
    });
    marked.clear();
    thumbsStale = true;
    paintNow(...painted);
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  const issueRay = new THREE.Raycaster();
  const disposeTree = (root: THREE.Object3D) =>
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ) {
        object.geometry.dispose();
        for (const m of [object.material].flat() as THREE.Material[]) m.dispose();
      }
    });
  /** Pixel-width lines take the canvas size in CSS px. */
  function fitLines(root: THREE.Object3D) {
    root.traverse((object) => {
      if (object instanceof LineSegments2)
        (object.material as LineMaterial).resolution.set(size.width, size.height);
    });
  }
  /** Each layer's marks as world segments, for the reach test (lines exactly, volumes by box). */
  const reachOf = new Map<string, Float32Array>();
  /** World segments of a layer's marks: its pixel lines exactly, anything else by its box edges. */
  const segmentsOf = (group: THREE.Group) => {
    group.updateMatrixWorld(true);
    const out: number[] = [];
    const p = new THREE.Vector3();
    const box = new THREE.Box3();
    group.traverse((object) => {
      if (object instanceof LineSegments2) {
        if (object.userData.casing) return;
        const start = object.geometry.getAttribute("instanceStart");
        const end = object.geometry.getAttribute("instanceEnd");
        for (let i = 0; i < start.count; i++)
          for (const a of [start, end])
            out.push(...p.fromBufferAttribute(a, i).applyMatrix4(object.matrixWorld).toArray());
      } else if (object instanceof THREE.Mesh && object.layers.isEnabled(0)) {
        box.setFromObject(object);
        const { min, max } = box;
        const corner = (i: number) => [
          i & 1 ? max.x : min.x,
          i & 2 ? max.y : min.y,
          i & 4 ? max.z : min.z,
        ];
        for (const [i, j] of BOX_EDGES) out.push(...corner(i), ...corner(j));
      }
    });
    return new Float32Array(out);
  };
  /** Screen distance (CSS px) from a point to the nearest projected segment; Infinity off-screen. */
  const distanceTo = (segments: Float32Array, x: number, y: number, camera: THREE.Camera) => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let best = Infinity;
    for (let i = 0; i < segments.length; i += 6) {
      a.set(segments[i]!, segments[i + 1]!, segments[i + 2]!).project(camera);
      b.set(segments[i + 3]!, segments[i + 4]!, segments[i + 5]!).project(camera);
      if (a.z > 1 || b.z > 1) continue;
      const ax = ((a.x + 1) / 2) * size.width,
        ay = ((1 - a.y) / 2) * size.height;
      const dx = ((b.x + 1) / 2) * size.width - ax,
        dy = ((1 - b.y) / 2) * size.height - ay;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
      );
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };

  // Element outlines: each marked element's triangles, drawn only into the outline mask.
  const outlined = new THREE.Group();
  outlined.position.copy(origin);
  scene.add(outlined);
  const marked = new Map<number, Mark>();
  /** Revit ids of the selected elements, for marks standing on them. */
  const selectedIds = new Set<number>();
  let hoveredElement: string | null = null;
  type Paint = [
    selected: ReadonlySet<string> | undefined,
    hidden: ReadonlySet<string> | undefined,
    isolated: ReadonlySet<string> | null | undefined,
    lit: ReadonlySet<string> | undefined,
  ];
  let painted: Paint = [undefined, undefined, undefined, undefined];
  const paintNow = (...[selected, hidden, isolated, lit]: Paint) => {
    const next = new Map<number, Mark>();
    byId.forEach(({ key }, id) => {
      const shown = !hidden?.has(key) && (!isolated || isolated.has(key));
      batch.setVisibleAt(id, shown);
      const mark: Mark | null = !shown
        ? null
        : selected?.has(key)
          ? "selected"
          : lit?.has(key)
            ? "lit"
            : key === hoveredElement
              ? "hover"
              : null;
      if (mark) next.set(id, mark);
      if (mark !== (marked.get(id) ?? null))
        batch.setColorAt(id, mark ? colors[id]!.clone().lerp(ink, FILL[mark]) : colors[id]!);
    });
    marked.clear();
    selectedIds.clear();
    for (const [id, mark] of next) {
      marked.set(id, mark);
      const revitId = byId[id]!.revitId;
      if (mark === "selected" && revitId != null) selectedIds.add(revitId);
    }
    for (const child of [...outlined.children]) {
      outlined.remove(child);
      disposeTree(child);
    }
    for (const mark of ["selected", "lit", "hover"] as const) {
      const ids = [...marked].filter(([, m]) => m === mark).slice(0, OUTLINED);
      if (!ids.length) continue;
      const positions = new Float32Array(ids.reduce((n, [id]) => n + byId[id]!.vertexCount * 3, 0));
      let at = 0;
      for (const [id] of ids) {
        const { firstVertex, vertexCount } = byId[id]!;
        for (let i = firstVertex * 3; i < (firstVertex + vertexCount) * 3; i++)
          positions[at++] = meshes.positions[i]! - origin.getComponent(i % 3);
      }
      const mesh = new THREE.Mesh(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3),
        ),
        new THREE.MeshBasicMaterial({
          color: OUTLINE_CHANNEL[mark],
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.layers.set(OUTLINE_LAYER);
      mesh.frustumCulled = false;
      outlined.add(mesh);
    }
    render();
  };

  return {
    canvas,
    gestureSize: () => [size.height, viewHeight(camera, controls.target)] as const,
    controls,
    moves,
    /** The camera the picture shows now: the orbit's, or the plane's. */
    active,
    batch,
    origin,
    byId,
    pick: createMeshPicker(batch, byId),
    pickIssue(at: { clientX: number; clientY: number }): IssueTarget | null {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      issueRay.setFromCamera(
        new THREE.Vector2(
          ((at.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((at.clientY - rect.top) / rect.height) * 2,
        ),
        active(),
      );
      // A seven-pixel hit allowance keeps short join bars usable at a system-wide fit.
      issueRay.params.Line!.threshold = plane
        ? ((ortho.top - ortho.bottom) / rect.height) * 7
        : (viewHeight(camera, controls.target) / rect.height) * 7;
      // Pixel lines: their own width plus this many px across.
      issueRay.params.Line2 = { threshold: 12 };
      let nearest = Infinity;
      let picked: IssueTarget | null = null;
      for (const { layer, group } of layers.values()) {
        if (!layer.targets?.length) continue;
        group.updateMatrixWorld(true);
        const hit = issueRay.intersectObject(group, true)[0];
        if (!hit || hit.distance >= nearest) continue;
        nearest = hit.distance;
        picked =
          layer.targets.find((t) => t.key === litIssue || t.key === focusedIssue) ??
          layer.targets[0]!;
      }
      return picked;
    },
    lightIssue(hovered: string | null, focused: string | null) {
      if (focused !== focusedIssue && focused !== null) focusedAt = performance.now() / 1000;
      litIssue = hovered;
      focusedIssue = focused;
      render();
    },
    /** The pointer approaching marks: the nearest issue within `REACH_PX` takes the reach rung. */
    reach(at: { clientX: number; clientY: number } | null) {
      let next: string | null = null;
      if (at) {
        const rect = canvas.getBoundingClientRect();
        const x = at.clientX - rect.left,
          y = at.clientY - rect.top;
        let nearest = REACH_PX;
        for (const { layer } of layers.values()) {
          const segments = reachOf.get(layer.key);
          if (!segments || !layer.targets?.length) continue;
          const d = distanceTo(segments, x, y, active());
          if (d > nearest) continue;
          nearest = d;
          next = layer.targets[0]!.key;
        }
      }
      if (next === reachedIssue) return;
      reachedIssue = next;
      render();
    },
    render,
    viewport: (): OrbitViewport => fromControls(controls, bounds),
    setOrbitPivot(pivot: readonly number[] | null) {
      orbitPivot = pivot;
    },
    setViewport(v: OrbitViewport) {
      if ((v.projection === "parallel") !== camera instanceof THREE.OrthographicCamera) {
        camera = newCamera(size.width / size.height, v.projection);
        controls.object = camera;
      }
      placeCamera(camera, v, bounds, size.width / size.height);
      const pose = toCamera(v, bounds);
      controls.target.fromArray(pose.target);
      controls.update();
      if (plane) thumbsStale = true;
      render();
    },
    /** The plane picture's pose, or null while the orbit is shown. */
    plane: (): PlaneViewport | null => plane?.viewport ?? null,
    /** Show an axis orthographically (orbit controls off), or null for the orbit. */
    setPlane(next: { axis: PlaneAxis; viewport: PlaneViewport } | null) {
      if (next?.axis !== plane?.axis) thumbsStale = true;
      plane = next;
      controls.enabled = !plane;
      if (plane) place(plane.axis, plane.viewport, size);
      render();
    },
    setThumbs(next: Partial<Record<PlaneAxis, HTMLCanvasElement | null>>) {
      thumbs = next;
      thumbsStale = true;
      render();
    },
    setOnFrame(next: typeof onFrame) {
      onFrame = next;
      framed = "";
      render();
    },
    reportFrame() {
      framed = "";
      tell();
    },
    paint(...args: Paint) {
      // The thumbnails are each axis's overview: they redraw when what is shown changes, never for
      // a selection or a hover. A redraw is three scene renders and a GPU readback, ~200 ms of
      // main thread on a 1,600-element capture, which every click and hover used to pay.
      if (args[1] !== painted[1] || args[2] !== painted[2]) thumbsStale = true;
      painted = args;
      paintNow(...args);
    },
    /** The element under the pointer: a lighter fill and a thin outline. Null when none. */
    hoverElement(key: string | null) {
      if (key === hoveredElement) return;
      hoveredElement = key;
      paintNow(...painted);
    },
    setClip(volume: ClipVolume | null | undefined) {
      uniforms.clipPolygon.value = volume?.data ?? new Float32Array(3 * CLIP_POINTS * 2);
      uniforms.clipCount.value = volume?.counts ?? [0, 0, 0];
      uniforms.clipKeep.value = (volume?.keepInside ?? [true, true, true]).map(Number);
      thumbsStale = true;
      render();
    },
    /** One group per key, rebuilt when its layer object is replaced, disposed when its key leaves. */
    setLayers(next: readonly Layer3D[] = []) {
      // An equal layer list must not schedule three thumbnail renders and GPU readbacks.
      if (
        layers.size === next.length &&
        next.every((layer) => layers.get(layer.key)?.layer === layer)
      )
        return;
      for (const [key, held] of layers) {
        if (next.includes(held.layer)) continue;
        scene.remove(held.group);
        disposeTree(held.group);
        layers.delete(key);
        reachOf.delete(key);
      }
      for (const layer of next) {
        if (layers.has(layer.key)) continue;
        const group = new THREE.Group();
        group.name = layer.key;
        layer.build(group);
        scene.add(group);
        layers.set(layer.key, { layer, group });
        if (layer.targets?.length) reachOf.set(layer.key, segmentsOf(group));
      }
      glowing = false;
      for (const { group } of layers.values())
        group.traverse(
          (object) =>
            void (glowing ||=
              object.layers.isEnabled(GLOW_LAYER) || object.layers.isEnabled(BEACON_LAYER)),
        );
      fitLines(scene);
      thumbsStale = true;
      render();
    },
    dispose() {
      mark("dispose");
      onFrame = null;
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", render);
      theme.disconnect();
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.removeEventListener("end", turnEnd);
      controls.dispose();
      canvas.removeEventListener("pointerdown", planeDown);
      window.removeEventListener("pointermove", planeMove);
      window.removeEventListener("pointerup", planeUp);
      canvas.removeEventListener("pointerdown", turnStart, true);
      releaseGestures();
      batch.dispose();
      scene.remove(batch);
      material.dispose();
      disposeTree(scene);
      glow.dispose();
      outline.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export type SceneRenderer = ReturnType<typeof createRenderer>;
