/** Scene3D's imperative renderer. Batch vertices are bounds-centred to preserve float32 fidelity;
 * camera poses, layers and picks stay in world feet. One swappable orbit camera (perspective or
 * parallel) drives OrbitControls; an axis picture swaps in an orthographic camera that only pans
 * and zooms. Thumbnails reuse this context only when stale. Space owns cut geometry; only packed
 * polygons cross into the material shader. */
import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { createGlow, GLOW_LAYER, OCCLUDER_LAYER } from "./glow";
import { createOutline, OUTLINE_LAYER } from "./outline";
import {
  fogDensity,
  GROUND_MATERIAL,
  keySlot,
  LOOK,
  OUTLINE_CHANNEL,
  paintOf,
  sceneGrounds,
  type Look,
} from "./grounds";
import {
  bakeVeil,
  CONTEXT_ALPHA,
  falloff,
  setVeilField,
  setVeilLook,
  veilMaterial,
  veilDistance,
  veilUniforms,
  type VeilField,
} from "./veil";
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
import { setDamageHue } from "./damage";
import type {
  IssueState,
  IssueTarget,
  Layer3D,
  Paint as InstancePaint,
  PaintOf,
  Pick,
  SceneInstance,
  SceneMeshes,
} from "./types";

/** Opt-in timing marks (`?scenePerf`), including GPU completion rather than a bare RAF tick. */
const timing = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf");
const mark = (phase: string, detail: Record<string, unknown> = {}) => {
  if (timing()) performance.mark(`scene:${phase}`, { detail });
};

/** Up to three extruded even-odd polygons whose intersection is kept, packed two points per vec4.
 * Frames (u, v): 0 = (x, y), 1 = (-x, z), 2 = (y, z), batch-local (relative to `origin`). */
export type ClipVolume = { data: Float32Array; counts: number[]; keepInside: boolean[] };
export type ContextMode = "halo" | "all";
/** Context alone in the first pass; the normal camera layers draw ducts and annotations after it. */
const CONTEXT_LAYER = 5;
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
/** Selection, hover and lighting lift the base system ink toward page ink. */
type Mark = "hover" | "lit" | "selected";

export function createRenderer(
  mount: HTMLElement,
  meshes: SceneMeshes,
  wheelHost = mount,
  initialPaint?: PaintOf,
) {
  const measuring = timing();
  mark("build-start", { instances: meshes.instances.length });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  let look: Look = LOOK.read();
  let grounds = sceneGrounds(mount, look);
  // Shared by reference with the outline pass and the fog: re-tinted in place, never replaced.
  const { ground, ink } = grounds;
  renderer.setClearColor(ground);
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "3D model. Drag orbits; Shift drag, right drag or two-finger scroll pans; wheel or pinch zooms to the cursor; double-click frames. Click an element to pick it; right click or BX shows it in Revit.",
  );
  canvas.tabIndex = 0;
  canvas.className = "block size-full";
  mount.prepend(canvas);
  const outline = createOutline(renderer, ink, ground);

  const bounds = meshes.bounds;
  const origin = new THREE.Vector3(...center(bounds));
  const scene = new THREE.Scene();
  const hemisphere = new THREE.HemisphereLight();
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight();
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
  const material = new THREE.MeshLambertMaterial({ ...GROUND_MATERIAL, side: THREE.DoubleSide });
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
  const veil = veilUniforms();
  veilMaterial(material, veil, true);
  const batch = new THREE.BatchedMesh(
    meshes.instances.length,
    meshes.positions.length / 3,
    0,
    material,
  );
  // Two passes reuse the same batch and its back-to-front instance sort. Context never owns depth.
  batch.position.copy(origin);
  batch.layers.enable(OCCLUDER_LAYER);
  batch.layers.enable(CONTEXT_LAYER);
  for (const light of [hemisphere, sun]) light.layers.enable(CONTEXT_LAYER);
  scene.add(batch);
  const glow = createGlow(renderer, material);
  /** What a look change re-applies besides instance tints: ground, lights, fog, veil, passes. */
  const applyStage = () => {
    setDamageHue(grounds.damage);
    renderer.setClearColor(ground);
    hemisphere.color.copy(grounds.lights.sky);
    hemisphere.groundColor.copy(grounds.lights.floor);
    hemisphere.intensity = look.lights.hemisphere;
    sun.color.copy(grounds.lights.sun);
    sun.intensity = look.lights.sunIntensity;
    // Camera-depth fog is optional and off by default; the veil is the element-anchored fog.
    scene.fog = look.fog.depth
      ? new THREE.FogExp2(ground, fogDensity(bounds, look.fog.density))
      : null;
    setVeilLook(veil, look.veil, ground);
    veil.subjectRim.value = look.depth.rim;
    outline.setWidths(look.outline);
    glow.setLook(look.glow);
  };
  applyStage();
  const byId: SceneInstance[] = [];
  let paintBy = initialPaint;
  const paints: InstancePaint[] = [];
  const tint = (id: number, mark: Mark | null = null) => {
    const paint = paints[id]!;
    // Highlighting changes ink only. Promoting a floor to subject made it fully opaque.
    const { tier } = paint;
    const color = (
      tier === "context"
        ? grounds.context
        : look.subject.bySystem && paint.key !== undefined
          ? grounds.palette[keySlot(paint.key, grounds.palette.length)]!
          : grounds.subject
    ).clone();
    if (mark) color.lerp(ink, look.fill[mark]);
    const alpha =
      tier === "context"
        ? CONTEXT_ALPHA
        : tier === "stub"
          ? Math.min(
              look.subject.stubOpacity,
              look.depth.everythingTranslucent ? look.depth.translucentOpacity : 1,
            )
          : look.depth.everythingTranslucent
            ? look.depth.translucentOpacity
            : look.subject.opacity;
    batch.setColorAt(id, new THREE.Vector4(color.r, color.g, color.b, alpha));
  };
  /** Instance index to batch id, for the veil's subject test. */
  const idOf: number[] = [];
  let field: VeilField;
  const bake = () => {
    field = bakeVeil(meshes, (i) => paints[idOf[i]!]!.tier !== "context");
    setVeilField(veil, field);
  };
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
    byId[id] = instance;
    idOf.push(id);
    paints[id] = paintOf(instance, paintBy);
    tint(id);
    geometry.dispose();
  }
  mark("geometry", { meshes: byId.length, multiDraw: renderer.extensions.has("WEBGL_multi_draw") });
  bake();
  mark("veil");
  LOOK.offer(
    "layers",
    "hiddenCategories",
    [...new Set(meshes.instances.map((i) => i.category))].sort(),
  );

  let frame = 0;
  let sizePending = false;
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
  /** Context cannot attenuate a duct, even through arbitrarily many overlapping slabs. */
  const drawScene = (shown: THREE.Camera) => {
    const mask = shown.layers.mask;
    const autoClear = renderer.autoClear;
    shown.layers.set(CONTEXT_LAYER);
    veil.scenePass.value = 0;
    material.depthWrite = false;
    renderer.render(scene, shown);
    shown.layers.mask = mask;
    veil.scenePass.value = 1;
    material.depthWrite = !look.depth.everythingTranslucent;
    renderer.autoClear = false;
    renderer.render(scene, shown);
    renderer.autoClear = autoClear;
  };
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
        drawScene(camera);
        resizeCamera(camera, size.width / size.height);
      } else {
        place(axis, fitPlane(axis, bounds, at), at);
        drawScene(ortho);
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
      // A pane drag scales the retained picture; observers and animation resume at release.
      if (mount.closest("[data-pane-resizing]")) return render();
      if (sizePending) measure();
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
            look,
            seconds,
            reducedMotion: motion.matches,
            state,
            landed: state === "focus" ? seconds - focusedAt : Infinity,
            selected: !!layer.targets?.some((t) => selectedIds.has(t.elementId)),
            lit: !!layer.targets?.some((t) => litIds.has(t.elementId)),
          }) || animate;
      }
      // Geometry is unchanged between the main, thumbnail, glow and outline passes.
      // Update transforms once, including any frame callback's changes, before all passes.
      scene.updateMatrixWorld();
      if (thumbsStale) drawThumbs();
      drawScene(active());
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
  const measure = () => {
    sizePending = false;
    if (mount.clientWidth === 0 || mount.clientHeight === 0) return;
    const next = { width: mount.clientWidth, height: mount.clientHeight };
    if (next.width === size.width && next.height === size.height) return;
    size = next;
    renderer.setSize(size.width, size.height, false);
    glow.setSize(size.width, size.height);
    outline.setSize(size.width, size.height);
    fitLines(scene);
    resizeCamera(camera, size.width / size.height);
    if (plane) place(plane.axis, plane.viewport, size);
    thumbsStale = true;
  };
  // Resize clears WebGL: measure and draw in the same frame, never in ResizeObserver delivery.
  const resize = () => {
    sizePending = true;
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
  let glowing = false;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", render);
  /** The one re-apply path: a theme change or a look change re-reads grounds and re-tints. */
  const applyLook = () => {
    const next = sceneGrounds(mount, look);
    ground.copy(next.ground);
    ink.copy(next.ink);
    grounds = { ...next, ground, ink };
    applyStage();
    byId.forEach((_, id) => tint(id, marked.get(id) ?? null));
    thumbsStale = true;
    paintNow(...painted);
  };
  const theme = new MutationObserver(applyLook);
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

  const outlined = new THREE.Group();
  outlined.position.copy(origin);
  scene.add(outlined);
  const marked = new Map<number, Mark>();
  /** Revit ids of the selected elements, for marks standing on them. */
  const selectedIds = new Set<number>();
  const litIds = new Set<number>();
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
    const hiddenCategories = new Set(look.layers.hiddenCategories);
    byId.forEach(({ key, category }, id) => {
      const shown =
        !hidden?.has(key) && (!isolated || isolated.has(key)) && !hiddenCategories.has(category);
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
      if (mark !== (marked.get(id) ?? null)) tint(id, mark);
    });
    marked.clear();
    selectedIds.clear();
    litIds.clear();
    for (const [id, mark] of next) {
      marked.set(id, mark);
      const revitId = byId[id]!.revitId;
      if (revitId != null) litIds.add(revitId);
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

  const pick = createMeshPicker(batch, byId);
  return {
    canvas,
    gestureSize: () => [size.height, viewHeight(camera, controls.target)] as const,
    controls,
    moves,
    /** The camera the picture shows now: the orbit's, or the plane's. */
    active,
    pick(ray: THREE.Ray, clip?: (hit: Pick) => boolean) {
      return pick(ray, (hit) => {
        if (veil.veilHalo.value && paintOf(hit.instance, paintBy).tier === "context") {
          const distance = veilDistance(field, hit.point);
          if (distance >= veil.veilFar.value) return false;
          const opacity =
            veil.veilMaxOpacity.value *
            falloff(
              distance,
              veil.veilNear.value,
              veil.veilFar.value,
              veil.veilCurve.value,
            );
          if (opacity < 0.004) return false;
        }
        return clip?.(hit) ?? true;
      });
    },
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
    /** Re-apply a changed look (the dev knobs) without rebuilding the scene. */
    setLook(next: Look) {
      if (next === look) return;
      look = next;
      applyLook();
    },
    /** Purely visual: no capture or distance-field bake when a context layer changes. */
    setContextMode(mode: ContextMode = "all") {
      veil.veilHalo.value = mode === "halo";
      thumbsStale = true;
      render();
    },
    /** Who is subject, stub or context, and each subject's colour key; re-bakes the veil. */
    setPaint(next: PaintOf | undefined) {
      if (next === paintBy) return;
      paintBy = next;
      let changedSubject = false;
      byId.forEach((instance, id) => {
        const paint = paintOf(instance, paintBy);
        changedSubject ||= (paint.tier === "context") !== (paints[id]!.tier === "context");
        paints[id] = paint;
      });
      if (changedSubject) bake();
      byId.forEach((_, id) => tint(id, marked.get(id) ?? null));
      thumbsStale = true;
      render();
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
        group.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line)
            for (const m of [object.material].flat() as THREE.Material[]) veilMaterial(m, veil);
        });
        scene.add(group);
        layers.set(layer.key, { layer, group });
        if (layer.targets?.length) reachOf.set(layer.key, segmentsOf(group));
      }
      glowing = false;
      for (const { group } of layers.values())
        group.traverse((object) => void (glowing ||= object.layers.isEnabled(GLOW_LAYER)));
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
      veil.veilField.value.dispose();
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
