/** Scene3D's imperative renderer. Batch vertices are bounds-centred to preserve float32 fidelity;
 * camera poses, layers and picks stay in world feet. One swappable orbit camera (perspective or
 * parallel) drives OrbitControls; an axis picture swaps in an orthographic camera that only pans
 * and zooms. Thumbnails reuse this context only when stale. Callers author polygon cuts or typed
 * world-foot sections; drawing and picking consume the same clip volume. */
import * as THREE from "three";
import type { PreparedGeometry } from "./prepare-geometry";
import { sceneDiagnostics } from "./scene-diagnostics";
import { SceneGpuMemory } from "./scene-gpu";
import { sceneMemory } from "./scene-memory";
import { planPaint, type ScenePlan } from "./scene-plan";
import { SceneMeshes } from "./types";
import { instancePositions } from "./primitives";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { createGlow, GLOW_LAYER, OCCLUDER_LAYER } from "./glow";
import { createDamageBatch } from "./damage-batch";
import { createMarkBatch } from "./mark-batch";
import { createOutline, OUTLINE_LAYER, veilOutline } from "./outline";
import { liftLightness } from "./oklch";
import {
  CONTEXT_CREASE_DEG,
  GROUND_MATERIAL,
  LOOK,
  OUTLINE_CHANNEL,
  paintOf,
  sceneGrounds,
  type Look,
} from "./grounds";
import {
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
import { createFacePicker } from "./picking";
import { FaceBatches, prepareFaceBatches, uploadFaceBatches } from "./face-batches";
import { contextVisible } from "./context";
import { clipContains, rebaseCaps, rebaseClip, sectionPlanes, type Section } from "./section";
import { sectionCaps } from "./section-caps";
import { createOrbitControls } from "./orbit-controls";
import {
  center,
  fromControls,
  rotateAbout,
  boundsOfInstances,
  cameraBounds,
  boundOrbit,
  boundsIncludingView,
  mixCameraBounds,
  cameraReturnProgress,
  fitDistance,
  HALF_FOV_TAN,
  type CameraBounds,
  type OrbitViewport,
} from "./orbit";
import {
  fitPlane,
  frameRect,
  fromFrame,
  boundPlane,
  planeCentre,
  type PlaneAxis,
  type PlaneViewport,
} from "./plane";
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
import { kindHue, kindL } from "./kinds";
import { routeColour, routeLines, surfaceEdges, shellLines, surfaceAlpha } from "./surfaces";
import type {
  IssueState,
  IssueTarget,
  Layer3D,
  LayerFrame,
  Kinds,
  Paint as InstancePaint,
  PaintOf,
  Pick,
  SceneInstance,
} from "./types";

/** Opt-in timing marks (`?scenePerf`), including GPU completion rather than a bare RAF tick. */
const timing = () =>
  typeof location !== "undefined" && new URLSearchParams(location.search).has("scenePerf");
const mark = (phase: string, detail: Record<string, unknown> = {}) => {
  if (timing()) performance.mark(`scene:${phase}`, { detail });
};

/** Up to three extruded even-odd polygons plus an optional world-foot section. Polygon frames
 * (u, v): 0 = (x, y), 1 = (-x, z), 2 = (y, z), batch-local (relative to `origin`). */
export type ClipVolume = {
  data: Float32Array;
  counts: number[];
  keepInside: boolean[];
  section?: Section;
  preview?: boolean;
};
export type ContextMode = "off" | "lines" | "glass";
export type ColourMode = "firm" | "mono";
/** Optional translucent faces share a pass after the subject has established occlusion depth. */
const CONTEXT_LAYER = 5;
const SHELL_LAYER = 6;
/** Stub fragments of the subject batch: depth-only pre-pass, then the once-per-pixel fill. */
const STUB_LAYER = 7;
/** Stub seams draw after the stub fill, so they sit on top of it and never tint through it. */
const STUB_SEAM_LAYER = 8;
/** Points per axis polygon the shader reads; `space/state.ts` packs its cuts against it. */
export const CLIP_POINTS = 64;

const clipping = `
varying vec3 vClipPosition;
uniform vec4 clipPolygon[${(3 * CLIP_POINTS) / 2}];
uniform int clipCount[3];
uniform int clipKeep[3];
uniform vec4 sectionPlane[6];
uniform int sectionCount;
vec2 clipPoint(int a, int i) {
  vec4 q = clipPolygon[a * ${CLIP_POINTS / 2} + i / 2];
  return (i % 2 == 0) ? q.xy : q.zw;
}
vec2 frameOf(int a, vec3 p) { return a == 0 ? p.xy : a == 1 ? vec2(-p.x, p.z) : p.yz; }
void sceneClip() {
  for (int i = 0; i < 6; i++) {
    if (i >= sectionCount) break;
    if (dot(sectionPlane[i].xyz, vClipPosition) + sectionPlane[i].w < -0.000001) discard;
  }
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
/** Selection, hover and lighting lift the base system hue in OKLCH lightness (`LOOK.lift`). */
type Mark = "hover" | "lit" | "selected";

/** Keep only edge storage after upload; the completed async preparation must not own face arrays. */
function preparedEdges(
  meshes: SceneMeshes,
  edges: PreparedGeometry["edges"],
  angles: PreparedGeometry["angles"],
  ids: ReadonlyMap<string, number>,
  allocated: (buffers: ArrayBufferLike[]) => void,
) {
  const fallback = surfaceEdges(meshes, allocated);
  return (instance: SceneInstance, angle: number) => {
    const id = ids.get(instance.key)!;
    return angles[id] === angle && edges[id] ? edges[id]! : fallback(instance, angle);
  };
}

export function createRenderer(mount: HTMLElement, initialMeshes: SceneMeshes, wheelHost = mount) {
  let meshes = new SceneMeshes(new Float32Array(), initialMeshes.bounds, []);
  const measuring = timing();
  mark("build-start", { instances: meshes.instances.length });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  let look: Look = LOOK.read();
  let grounds = sceneGrounds(mount, look);
  // Shared by reference with the outline pass and the fog: re-tinted in place, never replaced.
  const { ground, ink } = grounds;
  const isDark = () => ground.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
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

  let bounds = meshes.bounds;
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
    if (constraining) return;
    if (rotating && orbitPivot) rotateAbout(camera, controls.target, orbitPivot, beforeTurn);
    enforceCamera();
    beforeTurn.copy(camera.quaternion);
  });
  // OrbitControls cancels every contextmenu, which would starve the app's element menu (it skips a
  // cancelled press). Scene3D decides instead: a right-drag pan cancels, a right click passes.
  canvas.removeEventListener(
    "contextmenu",
    (controls as unknown as { _onContextMenu: EventListener })._onContextMenu,
  );
  /** Every camera gesture, orbit or plane, as OrbitControls names them: start, change, end. */
  const moves = new THREE.EventDispatcher<
    Record<"start" | "change" | "end", object> & { bounds: { settled: boolean } }
  >();
  for (const type of ["start", "change", "end"] as const)
    controls.addEventListener(type, () => moves.dispatchEvent({ type }));
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1);
  let plane: { axis: PlaneAxis; viewport: PlaneViewport } | null = null;
  const active = (): THREE.Camera => (plane ? ortho : camera);
  let subjectBounds: ReturnType<typeof boundsOfInstances> = null;
  let limits = subjectBounds
    ? cameraBounds(subjectBounds, look.camera.zoomOutFactor, look.camera.panMargin)
    : null;
  let returning: {
    from: CameraBounds;
    to: CameraBounds;
    elapsed: number;
    last: number | null;
  } | null = null;
  let constraining = false;
  const aspect = () => Math.max(mount.clientWidth, 1) / Math.max(mount.clientHeight, 1);
  const limitViewport = (v: OrbitViewport) => boundOrbit(v, bounds, limits, aspect());
  const placeViewport = (v: OrbitViewport) => {
    constraining = true;
    if ((v.projection === "parallel") !== camera instanceof THREE.OrthographicCamera) {
      camera = newCamera(aspect(), v.projection);
      controls.object = camera;
    }
    placeCamera(camera, v, bounds, aspect());
    controls.target.fromArray(v.pivot);
    controls.update();
    constraining = false;
  };
  function enforceCamera() {
    if (constraining) return;
    const now = fromControls(controls, bounds);
    const next = limitViewport(now);
    if (
      Math.abs(Math.log(next.zoom / now.zoom)) < 1e-10 &&
      next.pivot.every((n, i) => Math.abs(n - now.pivot[i]!) < 1e-8)
    )
      return;
    placeViewport(next);
  }
  const returnInside = (v = fromControls(controls, bounds)) => {
    if (!subjectBounds) return;
    const to = cameraBounds(subjectBounds, look.camera.zoomOutFactor, look.camera.panMargin);
    const at = { width: Math.max(mount.clientWidth, 1), height: Math.max(mount.clientHeight, 1) };
    const planeOutside = plane && boundPlane(plane.axis, plane.viewport, at, to) !== plane.viewport;
    if (boundOrbit(v, bounds, to, aspect()) === v && !planeOutside) {
      limits = to;
      returning = null;
      return;
    }
    let from = boundsIncludingView(to, v, bounds, aspect());
    if (plane) {
      const [u, w] = planeCentre(plane.viewport, at);
      const rect = frameRect(plane.axis, subjectBounds);
      from = boundsIncludingView(
        from,
        {
          ...v,
          projection: "parallel",
          zoom:
            (2 *
              fitDistance(bounds) *
              HALF_FOV_TAN *
              Math.max(1, aspect()) *
              plane.viewport.scale) /
            Math.max(at.width, at.height),
          pivot: fromFrame(plane.axis, u, w, (rect.w0 + rect.w1) / 2),
        },
        bounds,
        aspect(),
      );
    }
    limits = from;
    returning = { from, to, elapsed: 0, last: null };
    render();
  };

  const uniforms = {
    sceneOrigin: { value: origin },
    clipPolygon: { value: new Float32Array(3 * CLIP_POINTS * 2) as Float32Array },
    clipCount: { value: [0, 0, 0] },
    clipKeep: { value: [1, 1, 1] },
    sectionPlane: { value: new Float32Array(24) },
    sectionCount: { value: 0 },
  };
  let clipVolume: ClipVolume | null | undefined;
  const caps = new Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();
  let capStamp = "";
  const material = new THREE.MeshLambertMaterial({ ...GROUND_MATERIAL, side: THREE.DoubleSide });
  const applyClip = (target: THREE.Material) => {
    if (target.userData.sceneClipped) return;
    target.userData.sceneClipped = true;
    const before = target.onBeforeCompile;
    target.onBeforeCompile = (shader, renderer) => {
      before.call(target, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader =
        `uniform vec3 sceneOrigin;\nvarying vec3 vClipPosition;\n${shader.vertexShader}`.replace(
          "#include <fog_vertex>",
          "#include <fog_vertex>\nvClipPosition = (inverse(viewMatrix) * mvPosition).xyz - sceneOrigin;",
        );
      shader.fragmentShader = `${clipping}\n${shader.fragmentShader}`.replace(
        "#include <fog_fragment>",
        "sceneClip();\n#include <fog_fragment>",
      );
    };
    const key = target.customProgramCacheKey.bind(target);
    target.customProgramCacheKey = () => `${key()}|scene-clip-world-v3`;
  };
  applyClip(material);
  const veil = veilUniforms();
  let contextRadiusFt: number | undefined;
  /** The Context dial: off draws nothing, lines the creases alone, glass creases plus the pane. */
  let contextMode: ContextMode = "glass";
  veilMaterial(material, veil, "tier");
  // Context is a line drawing: creases at one weight, faded per fragment by the veil field.
  const contextMaterial = new THREE.LineBasicMaterial({
    color: grounds.ink,
    transparent: true,
    opacity: look.veil.lineAlpha,
    depthWrite: false,
  });
  applyClip(contextMaterial);
  veilMaterial(contextMaterial, veil, "line");
  let batch = new FaceBatches(undefined, undefined, []);
  for (const light of [hemisphere, sun]) {
    light.layers.enable(CONTEXT_LAYER);
    light.layers.enable(SHELL_LAYER);
  }
  const glow = createGlow(renderer);
  /** The occluded-mark alpha every highlight shares (`LOOK.depth.occludedAlpha`). */
  const occluded = { value: look.depth.occludedAlpha };
  /** What a look change re-applies besides instance tints: ground, lights, fog, veil, passes. */
  const applyStage = () => {
    setDamageHue(grounds.damage);
    renderer.setClearColor(ground);
    hemisphere.color.copy(grounds.lights.sky);
    hemisphere.groundColor.copy(grounds.lights.floor);
    hemisphere.intensity = look.lights.hemisphere;
    sun.color.copy(grounds.lights.sun);
    sun.intensity = look.lights.sunIntensity;
    // The veil is the only fade (element-anchored); there is no camera-depth fog. One reach:
    // the page's Nearby radius is the veil far edge and the stub fade.
    setVeilLook(veil, look.veil, contextRadiusFt);
    veil.subjectRim.value = look.depth.rim;
    veil.stubEndAlpha.value = look.subject.stubEndAlpha;
    contextMaterial.color.copy(ink);
    contextMaterial.opacity = look.veil.lineAlpha;
    outline.setWidths(look.outline);
    outline.setOccluded(look.depth.occludedAlpha, look.depth.occludedWidth);
    occluded.value = look.depth.occludedAlpha;
    glow.setLook(look.glow);
  };
  applyStage();
  const byId: SceneInstance[] = [];
  let paintBy: PaintOf | undefined;
  const paints: InstancePaint[] = [];
  /** Kind picks the hue; "mono" or a table without the kind or `unknown` is the subject ink. */
  let kinds: Kinds = {};
  let colourMode: ColourMode = "firm";
  let huesStamp = "";
  const subjectHue = (p: InstancePaint) =>
    (colourMode === "firm" ? kindHue(kinds, p.kind) : undefined) ?? grounds.subject;
  const subjectL = (p: InstancePaint) => (colourMode === "firm" ? kindL(kinds, p.kind) : undefined);
  const tint = (id: number, mark: Mark | null = null) => {
    const paint = paints[id]!;
    // Highlighting changes ink only. Promoting a floor to subject made it fully opaque.
    const { tier } = paint;
    const color = routeColour(
      tier === "envelope"
        ? grounds.shell
        : tier === "context"
          ? grounds.context
          : subjectHue(paint),
      paint,
      isDark(),
      tier === "subject" || tier === "stub" ? subjectL(paint) : undefined,
    );
    if (tier === "stub") color.lerp(ground, look.subject.stubGroundMix);
    // The rung rule: emphasis keeps the hue and lifts OKLCH lightness; the outline carries the rest.
    if (mark) color.copy(liftLightness(color, look.lift[mark]));
    const alpha = surfaceAlpha(paint, look);
    batch.setColorAt(id, new THREE.Vector4(color.r, color.g, color.b, alpha));
    const cap = caps.get(id);
    if (cap) {
      cap.material.color.copy(color);
      cap.material.opacity = alpha;
    }
  };
  let geometryAccountPending = true;
  let field: VeilField;
  // Viewport construction has no membership work. Replacements are prepared off-thread below.
  field = { data: new Uint8Array([255]), dims: [1, 1, 1], min: [0, 0, 0], cellFt: 1 };
  setVeilField(veil, field);

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
    v = boundPlane(axis, v, at, limits);
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
  let hasContext = false;
  let hasShell = false;
  // The 2026-10-26 ruling supersedes subject-over-context compositing: front context tints
  // the subject, while rear context fails its depth test. Translucent duct fill still occludes
  // equipment edges; opacity is not permission to draw those edges through a duct.
  /** Depth of real subject geometry, no colour, into the bound target: the one occluder set every
   * highlight tests against. The batch material keeps section cuts and per-element visibility;
   * context and envelopes discard in this pass, so translucent context never occludes a mark. */
  const seedOccluders = (shown: THREE.Camera) => {
    const layers = shown.layers.mask;
    material.colorWrite = false;
    material.depthWrite = true;
    shown.layers.set(STUB_LAYER);
    veil.scenePass.value = 6;
    renderer.render(scene, shown);
    shown.layers.set(OCCLUDER_LAYER);
    veil.scenePass.value = 1;
    renderer.render(scene, shown);
    material.colorWrite = true;
    shown.layers.mask = layers;
  };
  // `overlay` (highlight and damage composites) lands last. EXCEPTION to "front context tints a
  // highlight once like any subject": composited before the context pass, stacked context
  // (5+ faces) muted the selection ring to invisible (proto-3d-20261026 after-sa19-*-selected).
  // Kept: the highlight still obeys subject depth (`seedOccluders`); context never occludes it.
  const glass = (depthWrite: boolean) => {
    material.depthWrite = depthWrite;
    caps.forEach((cap) => {
      cap.material.depthWrite = depthWrite;
    });
  };
  /** Glass only: the allocated target, sized to the drawing buffer; null until first glass frame. */
  let contextDepth: THREE.WebGLRenderTarget | null = null;
  /** Context-only depth into `contextDepth` under the current viewport, then arms the fill's compare. */
  const drawContextDepth = (shown: THREE.Camera) => {
    const ratio = renderer.getPixelRatio();
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!contextDepth) {
      contextDepth = new THREE.WebGLRenderTarget(buffer.x, buffer.y, {
        depthTexture: new THREE.DepthTexture(buffer.x, buffer.y, THREE.UnsignedIntType),
      });
    } else if (contextDepth.width !== buffer.x || contextDepth.height !== buffer.y) {
      contextDepth.setSize(buffer.x, buffer.y);
    }
    // The pass must land where the fill will: the live viewport (thumbnails use a corner of it).
    contextDepth.viewport.copy(renderer.getViewport(new THREE.Vector4())).multiplyScalar(ratio);
    const target = renderer.getRenderTarget();
    veil.contextDepthSize.value.set(0, 0);
    glass(true);
    renderer.setRenderTarget(contextDepth);
    renderer.clear();
    renderer.render(scene, shown);
    renderer.setRenderTarget(target);
    veil.contextDepth.value = contextDepth.depthTexture;
    veil.contextDepthSize.value.set(buffer.x, buffer.y);
  };
  const drawScene = (shown: THREE.Camera, overlay?: () => void) => {
    const mask = shown.layers.mask;
    const autoClear = renderer.autoClear;
    renderer.clear();
    renderer.autoClear = false;
    material.depthWrite = true;
    caps.forEach((cap) => {
      cap.material.depthWrite = true;
    });
    // Stub depth pre-pass: each pixel records its nearest stub surface, colour withheld.
    shown.layers.set(STUB_LAYER);
    veil.scenePass.value = 6;
    material.colorWrite = false;
    renderer.render(scene, shown);
    material.colorWrite = true;
    shown.layers.mask = mask;
    veil.scenePass.value = 1;
    renderer.render(scene, shown);
    // Stub fill: only the pixel's nearest stub passes EQUAL, so overlapping translucent pieces
    // blend once. Stub seams follow on their own layer, above the fill.
    shown.layers.set(STUB_LAYER);
    shown.layers.enable(STUB_SEAM_LAYER);
    veil.scenePass.value = 2;
    material.depthWrite = false;
    material.depthFunc = THREE.EqualDepth;
    renderer.render(scene, shown);
    material.depthFunc = THREE.LessEqualDepth;
    shown.layers.mask = mask;
    // 2026-10-27 glass, depth path: envelopes first, then context as the nearest-surface pane,
    // drawn after every subject, stub, line and hull. A context-only depth pre-pass (same camera,
    // same viewport) records the nearest context surface; the fill discards anything behind it, so
    // crossing sheets never stack whatever their draw order. The fill still depth-tests the main
    // buffer, so context behind a subject is hidden and context in front tints it. The main buffer
    // never takes context depth (walls would hide ducts), so there is no sort. The sort-by-centre
    // attempt (2026-10-26) double-stacked crossing roof and chimney on Chadds.
    // EXCEPTION to the one-sorted-translucent-pass rule: context behind an equipment envelope
    // draws over it; equipment owns no depth and that ordering is unruled.
    glass(false);
    if (hasShell) {
      shown.layers.set(SHELL_LAYER);
      veil.scenePass.value = 4;
      renderer.render(scene, shown);
    }
    if (hasContext && contextMode === "glass" && batch.translucent) {
      shown.layers.set(CONTEXT_LAYER);
      veil.scenePass.value = 5;
      drawContextDepth(shown);
      glass(true);
      renderer.render(scene, shown);
      glass(false);
      veil.contextDepthSize.value.set(0, 0);
    }
    shown.layers.mask = mask;
    veil.scenePass.value = 1;
    glass(true);
    overlay?.();
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
        place(axis, fitPlane(axis, subjectBounds ?? bounds, at), at);
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
      let boundsSettled: boolean | null = null;
      if (returning) {
        const t = cameraReturnProgress(returning, started, look.camera.returnMs);
        limits = mixCameraBounds(returning.from, returning.to, 1 - (1 - t) ** 3);
        if (t === 1) returning = null;
        boundsSettled = t === 1;
      }
      enforceCamera();
      if (plane) {
        plane.viewport = boundPlane(plane.axis, plane.viewport, size, limits);
        place(plane.axis, plane.viewport, size);
      }
      if (boundsSettled !== null) moves.dispatchEvent({ type: "bounds", settled: boundsSettled });
      if (measuring) {
        renderer.info.autoReset = false;
        renderer.info.reset();
      }
      let animate = false;
      let appearanceChanged = false;
      const seconds = started / 1000;
      for (const held of layers.values()) {
        const { layer, group } = held;
        if (!layer.frame && !layer.damage) continue;
        const state = stateOf(layer);
        const selected = !!layer.targets?.some((t) => selectedIds.has(t.elementId));
        const lit = !!layer.targets?.some((t) => litIds.has(t.elementId));
        const before = held.appearance;
        // Camera motion changes projection, not issue appearance. Only changed states and finite
        // transitions run layer updates; semantic layer count must not multiply orbit work.
        if (
          before &&
          !before.animated &&
          before.revision === layerRevision &&
          before.state === state &&
          before.selected === selected &&
          before.lit === lit
        )
          continue;
        const at: LayerFrame = {
          look,
          contains: (point) => clipContains(clipVolume, point, origin.toArray()),
          shown: (key) => {
            const id = batchIdByKey.get(key);
            return id !== undefined && batch.getVisibleAt(id);
          },
          ink,
          seconds,
          reducedMotion: motion.matches,
          state,
          landed: state === "focus" ? seconds - focusedAt : Infinity,
          selected,
          lit,
        };
        const animated = layer.damage
          ? (damageBatch?.update(layer, at) ?? false)
          : layer.frame!(group, at);
        held.appearance = { revision: layerRevision, state, selected, lit, animated };
        appearanceChanged = true;
        animate ||= animated;
      }
      // Geometry is unchanged between the main, thumbnail, glow and outline passes.
      if (appearanceChanged && markBatch?.sync()) fitLines(markBatch.group);
      // Update transforms once, including any frame callback's changes, before all passes.
      scene.updateMatrixWorld();
      accountGeometry();
      if (thumbsStale) drawThumbs();
      const shown = active();
      drawScene(shown, () => {
        if (glowing) glow.render(scene, shown, () => seedOccluders(shown));
        if (outlined.children.length)
          outline.render(scene, shown, outlined, () => seedOccluders(shown));
      });
      if (measuring) fence(started);
      tell();
      if (animate || returning) render();
    });
  };
  const fence = (started: number) => {
    const info = renderer.info;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    mark("submitted", {
      instances: byId.length,
      focus: byId.filter((i) => i.focus).length,
      cpuMs: performance.now() - started,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    });
    const membership = { instances: byId.length, focus: byId.filter((i) => i.focus).length };
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const complete = () => {
      if (!sync || gl.isContextLost()) return;
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return void requestAnimationFrame(complete);
      gl.deleteSync(sync);
      mark(status === gl.WAIT_FAILED ? "gpu-failed" : "gpu-complete", { status, ...membership });
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
      viewport: boundPlane(
        plane.axis,
        {
          ...v,
          tx: v.tx + event.clientX - panning.x,
          ty: v.ty + event.clientY - panning.y,
        },
        size,
        limits,
      ),
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
      viewport: boundPlane(
        plane.axis,
        wheelPlane(
          plane.viewport,
          reading(event),
          event,
          event.clientX - rect.left,
          event.clientY - rect.top,
        ),
        size,
        limits,
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

  let layerRevision = 0;
  let damageBatch: ReturnType<typeof createDamageBatch> | null = null;
  let markBatch: ReturnType<typeof createMarkBatch> | null = null;
  const layers = new Map<
    string,
    {
      layer: Layer3D;
      group: THREE.Group;
      appearance?: {
        revision: number;
        state: IssueState;
        selected: boolean;
        lit: boolean;
        animated: boolean;
      };
    }
  >();
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
  const motionChanged = () => {
    layerRevision++;
    render();
  };
  motion.addEventListener("change", motionChanged);
  /** The one re-apply path: a theme change or a look change re-reads grounds and re-tints. */
  const applyLook = () => {
    geometryAccountPending = true;
    layerRevision++;
    routeGeometryDirty = true;
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
        if (object.userData.casing || object.userData.behind) return;
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
  const envelopes = new THREE.Group();
  scene.add(envelopes);
  let fallbackEdgeStorage: ArrayBufferLike[] = [];
  const ownFallbackEdges = (buffers: ArrayBufferLike[]) => {
    fallbackEdgeStorage = buffers;
    geometryAccountPending = true;
  };
  let edgesOf = surfaceEdges(meshes, ownFallbackEdges);
  const routes = new THREE.Group();
  scene.add(routes);
  let routeStamp = "";
  const rebuildRoutes = () => {
    const ids = byId.flatMap((_, id) =>
      paints[id]!.tier === "subject" || paints[id]!.tier === "stub"
        ? batch.getVisibleAt(id)
          ? [id]
          : []
        : [],
    );
    const stamp = JSON.stringify([
      ids.map((id) => [id, paints[id]]),
      look.routes,
      grounds.subject.getHex(),
      huesStamp,
    ]);
    if (stamp === routeStamp) return;
    routeStamp = stamp;
    while (routes.children.length) {
      const child = routes.children[0]!;
      routes.remove(child);
      disposeTree(child);
    }
    // One draw per (tier, ink): stub seams live on their own layer, drawn above the stub fill.
    const groups = new Map<string, { hex: number; stub: boolean; positions: number[] }>();
    for (const id of ids) {
      const p = paints[id]!;
      const hex = routeColour(subjectHue(p), p, isDark(), subjectL(p)).getHex();
      const stub = p.tier === "stub";
      const key = `${stub}|${hex}`;
      const group = groups.get(key) ?? { hex, stub, positions: [] };
      for (const n of edgesOf(byId[id]!, look.routes.edgeAngle)) group.positions.push(n);
      groups.set(key, group);
    }
    for (const { hex, stub, positions } of groups.values()) {
      const lines = routeLines(positions, new THREE.Color(hex), look);
      if (stub) lines.layers.set(STUB_SEAM_LAYER);
      applyClip(lines.material);
      fitLines(lines);
      routes.add(lines);
    }
  };
  const contextLines = new THREE.LineSegments(new THREE.BufferGeometry(), contextMaterial);
  contextLines.frustumCulled = false;
  contextLines.renderOrder = 2;
  scene.add(contextLines);
  const syncContextLines = () => (contextLines.visible = contextMode !== "off");
  let fieldRevision = 0;
  let contextStamp = "";
  /** Creases of visible context whose reach can show: a segment is kept if any of its two ends or
   * its middle lies inside the veil's far edge. The fragment fade does the rest. */
  const rebuildContextLines = () => {
    const ids = byId.flatMap((_, id) =>
      paints[id]!.tier === "context" && batch.getVisibleAt(id) ? [id] : [],
    );
    const stamp = JSON.stringify([ids, fieldRevision, veil.veilFar.value]);
    if (stamp === contextStamp) return;
    contextStamp = stamp;
    const positions: number[] = [];
    const reach = veil.veilFar.value;
    for (const id of ids) {
      const edges = edgesOf(byId[id]!, CONTEXT_CREASE_DEG);
      for (let n = 0; n + 5 < edges.length; n += 6) {
        const a = [edges[n]!, edges[n + 1]!, edges[n + 2]!];
        const b = [edges[n + 3]!, edges[n + 4]!, edges[n + 5]!];
        const m = a.map((v, i) => (v + b[i]!) / 2);
        if ([a, m, b].some((point) => veilDistance(field, point) < reach))
          positions.push(...a, ...b);
      }
    }
    contextLines.geometry.dispose();
    contextLines.geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
  };
  const batchIdByKey = new Map(byId.map((instance, id) => [instance.key, id]));
  let envelopeStamp = "";
  const rebuildEnvelopes = () => {
    const ids = byId.flatMap((_, id) =>
      paints[id]!.tier === "envelope" && batch.getVisibleAt(id) ? [id] : [],
    );
    const stamp = JSON.stringify([ids, look.shell, grounds.shell.getHex()]);
    if (stamp === envelopeStamp) return;
    envelopeStamp = stamp;
    while (envelopes.children.length) {
      const child = envelopes.children[0]!;
      envelopes.remove(child);
      disposeTree(child);
    }
    if (!ids.length) return;
    const positions: number[] = [];
    for (const id of ids)
      for (const n of edgesOf(byId[id]!, look.shell.edgeAngle)) positions.push(n);
    const lines = shellLines(positions, grounds.shell, look);
    applyClip(lines.material);
    fitLines(lines);
    envelopes.add(lines);
  };
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
  let routeGeometryDirty = true;
  const paintNow = (...[selected, hidden, isolated, lit]: Paint) => {
    geometryAccountPending = true;
    layerRevision++;
    hasContext = false;
    hasShell = false;
    const next = new Map<number, Mark>();
    byId.forEach(({ key, categoryId }, id) => {
      const shown =
        !hidden?.has(key) &&
        (!isolated || isolated.has(key)) &&
        contextVisible(categoryId, paints[id]!.tier, look.layers, paints[id]!.neighbour);
      if (batch.getVisibleAt(id) !== shown) {
        batch.setVisibleAt(id, shown);
        routeGeometryDirty = true;
      }
      hasContext ||= shown && paints[id]!.tier === "context";
      hasShell ||= shown && paints[id]!.tier === "envelope";
      const cap = caps.get(id);
      if (cap) cap.visible = shown && !clipVolume?.preview;
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
    // Selection and hover change ink, not route geometry. Do not serialize the whole building
    // merely to discover that its route stamp is unchanged on every pointer crossing.
    if (routeGeometryDirty) {
      rebuildEnvelopes();
      rebuildRoutes();
      rebuildContextLines();
      routeGeometryDirty = false;
    }
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
      const marks = [...marked].filter(([, m]) => m === mark).slice(0, OUTLINED);
      // One mesh per tier: context outlines veil (`veilOutline`), subject outlines do not.
      for (const context of [false, true]) {
        const ids = marks.filter(
          ([id]) => (paintOf(byId[id]!, paintBy).tier === "context") === context,
        );
        if (!ids.length) continue;
        const sources = ids.map(([id]) => instancePositions(meshes, byId[id]!));
        const positions = new Float32Array(sources.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const source of sources) {
          for (let i = 0; i < source.length; i++)
            positions[at++] = source[i]! - origin.getComponent(i % 3);
        }
        const mesh = new THREE.Mesh(
          new THREE.BufferGeometry().setAttribute(
            "position",
            new THREE.BufferAttribute(positions, 3),
          ),
          // Blending and depth test are set per mask pass (`outline.ts`); the offset lets the
          // element pass against its own seeded depth.
          new THREE.MeshBasicMaterial({
            color: OUTLINE_CHANNEL[mark],
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
          }),
        );
        applyClip(mesh.material);
        veilOutline(mesh.material, veil, context);
        mesh.layers.set(OUTLINE_LAYER);
        mesh.frustumCulled = false;
        outlined.add(mesh);
      }
    }
    render();
  };

  // Inspection prefers the subject through its translucent surroundings, then nearest in that tier.
  // This callback outlives replacement. Do not create it in the async preparation scope: that
  // scope also contains comparison closures over ~140 MB of temporary worker arrays.
  const pickPriority = (i: SceneInstance) => (paintOf(i, paintBy).tier === "context" ? 0 : 1);
  let pick = createFacePicker(batch, pickPriority);
  const rebuildCaps = () => {
    geometryAccountPending = true;
    const stamp = JSON.stringify([clipVolume?.section, look.section.cap]);
    if (clipVolume?.preview) {
      caps.forEach((cap) => {
        cap.visible = false;
      });
      return;
    }
    if (stamp === capStamp) {
      caps.forEach((cap, id) => {
        cap.visible = batch.getVisibleAt(id);
      });
      return;
    }
    capStamp = stamp;
    caps.forEach((cap) => {
      scene.remove(cap);
      cap.geometry.dispose();
      cap.material.dispose();
    });
    caps.clear();
    if (!clipVolume?.section || look.section.cap === "open") return;
    // Context boxes are bounds proxies, so their clipped faces stay open rather than claim a solid section.
    for (const cut of sectionCaps(
      meshes,
      clipVolume.section,
      (i) => !i.primitive || paintOf(i, paintBy).tier !== "context",
    )) {
      const id = byId.indexOf(cut.instance);
      if (id < 0) continue;
      const positions = rebaseCaps(cut.positions, clipVolume.section, origin.toArray());
      const geometry = new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "continuationDistance",
        new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(1e6), 1),
      );
      geometry.computeVertexNormals();
      const capMaterial = new THREE.MeshLambertMaterial({
        ...GROUND_MATERIAL,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      applyClip(capMaterial);
      veilMaterial(capMaterial, veil, "tier");
      const cap = new THREE.Mesh(geometry, capMaterial);
      cap.position.copy(origin);
      cap.visible = batch.getVisibleAt(id);
      if (paints[id]!.tier === "context") cap.layers.set(CONTEXT_LAYER);
      else if (paints[id]!.tier === "envelope") cap.layers.set(SHELL_LAYER);
      scene.add(cap);
      caps.set(id, cap);
      tint(id, marked.get(id) ?? null);
    }
  };
  const capRay = new THREE.Raycaster();
  capRay.layers.enableAll();
  const gpuMemory = new SceneGpuMemory();
  const geometryMemory = sceneMemory.acquire("uploaded", {});
  let edgeStorage: ArrayBufferLike[] = [];
  const accountGeometry = () => {
    if (!geometryAccountPending) return;
    geometryAccountPending = false;
    const footprint = gpuMemory.footprint(scene, [veil.veilField.value]);
    geometryMemory.update({
      ...footprint,
      buffers: [...(footprint.buffers ?? []), ...edgeStorage, ...fallbackEdgeStorage],
    });
  };
  const api = {
    meshes: () => meshes,
    diagnostics: sceneDiagnostics,
    clear() {
      api.setLayers([]);
      batch.disposeExcept();
      batch = new FaceBatches(undefined, undefined, []);
      for (const group of [outlined, routes, envelopes]) {
        for (const child of group.children.slice()) {
          group.remove(child);
          disposeTree(child);
        }
      }
      caps.forEach((cap) => {
        scene.remove(cap);
        disposeTree(cap);
      });
      caps.clear();
      capStamp = "";
      byId.length = 0;
      paints.length = 0;
      batchIdByKey.clear();
      meshes = new SceneMeshes(new Float32Array(), bounds, []);
      paintBy = undefined;
      geometryAccountPending = true;
      edgeStorage = [];
      fallbackEdgeStorage = [];
      edgesOf = () => new Float32Array();
      pick = createFacePicker(batch, pickPriority);
      field = { data: new Uint8Array([255]), dims: [1, 1, 1], min: [0, 0, 0], cellFt: 1 };
      fieldRevision++;
      setVeilField(veil, field);
      accountGeometry();
    },
    frameBounds: () => bounds,
    /** Camera zoom belongs to the caller's picture, independently of edit geometry bounds. */
    setFrameBounds(next: typeof bounds) {
      if (bounds === next) return;
      bounds = next;
      applyStage();
      render();
    },
    async stage(
      plan: ScenePlan,
      ready: PreparedGeometry,
      signal: AbortSignal,
      preserveLayers = false,
    ) {
      const next = plan.meshes;
      const check = () => signal.throwIfAborted();
      check();
      const nextPaints = plan.roles;
      const incoming = await prepareFaceBatches(
        next,
        ready,
        nextPaints,
        material,
        preserveLayers ? batch : undefined,
        check,
        gpuMemory,
      );
      try {
        await uploadFaceBatches(renderer, incoming, batch, active(), check);
        check();
      } catch (error) {
        incoming.disposeExcept(batch);
        throw error;
      }
      const reusedDepth = !!incoming.depth && incoming.depth.mesh === batch.depth?.mesh;
      // Keep immutable world-space edges and their programs only when their exact arrays match.
      // Matching keys alone would reuse stale lines after geometry or edge-angle changes.
      const sameEdges =
        preserveLayers &&
        next.instances.every((instance, index) => {
          const angle = ready.angles[index];
          if (angle == null) return true;
          const id = batchIdByKey.get(instance.key);
          if (id === undefined) return false;
          const previous = edgesOf(byId[id]!, angle),
            edge = ready.edges[index];
          return (
            !!edge && previous.length === edge.length && edge.every((n, i) => n === previous[i])
          );
        });
      mark("uploaded", { instances: next.instances.length, reusedDepth, sameEdges });
      let owned = true;
      return {
        release() {
          if (!owned) return;
          owned = false;
          incoming.disposeExcept(batch);
        },
        commit(appearance: PaintOf | undefined) {
          check();
          if (!owned) throw Error("Scene stage already released");
          owned = false;
          const nextPaint = planPaint(plan, appearance);
          const nextPaints = next.instances.map((i) => paintOf(i, nextPaint));
          // Atomic ownership transfer: no frame or picker sees half-installed membership.
          // Optional context keeps the same focus and already-current world-space diagnostics.
          // Clearing them here repeats their geometry build and stalls the held pointer.
          if (!preserveLayers) api.setLayers([]);
          caps.forEach((cap) => {
            scene.remove(cap);
            disposeTree(cap);
          });
          caps.clear();
          capStamp = "";
          for (const group of sameEdges ? [outlined] : [outlined, routes, envelopes]) {
            for (const child of group.children.slice()) {
              group.remove(child);
              disposeTree(child);
            }
          }
          batch.disposeExcept(incoming);
          batch = incoming;
          meshes = next;
          origin.fromArray(center(next.bounds));
          outlined.position.copy(origin);
          // Each part enters only the passes that keep its fragments: every pass submits and
          // sorts a whole batch, and the discarded half used to cost as much as the drawn one.
          batch.depth?.mesh.layers.enable(OCCLUDER_LAYER);
          batch.depth?.mesh.layers.enable(STUB_LAYER);
          batch.translucent?.mesh.layers.set(CONTEXT_LAYER);
          batch.translucent?.mesh.layers.enable(SHELL_LAYER);
          batch.addTo(scene);
          for (const part of batch.parts) gpuMemory.uploaded(part.mesh);
          byId.splice(0, byId.length, ...next.instances);
          paintBy = nextPaint;
          paints.splice(0, paints.length, ...nextPaints);
          batchIdByKey.clear();
          byId.forEach((i, id) => batchIdByKey.set(i.key, id));
          LOOK.offer(
            "layers",
            "hiddenCategories",
            [
              ...new Set(
                byId
                  .filter((_, id) => paints[id]!.tier === "context" || paints[id]!.tier === "stub")
                  .flatMap((i) => (i.categoryId === null ? [] : [String(i.categoryId)])),
              ),
            ].sort(),
            Object.fromEntries(
              byId
                .filter((i) => i.categoryId !== null)
                .map((i) => [String(i.categoryId), i.category]),
            ),
          );
          field = ready.field;
          fieldRevision++;
          setVeilField(veil, field);
          edgeStorage = ready.edges.flatMap((edge) => (edge ? [edge.buffer] : []));
          fallbackEdgeStorage = [];
          edgesOf = preparedEdges(
            meshes,
            ready.edges,
            ready.angles,
            batchIdByKey,
            ownFallbackEdges,
          );
          // Edge angles are structural: publish them with their prepared edge storage. Theme,
          // colour and opacity still apply immediately to the accepted geometry.
          if (
            look.shell.edgeAngle !== plan.shellAngle ||
            look.routes.edgeAngle !== plan.routeAngle
          ) {
            look = {
              ...look,
              shell: { ...look.shell, edgeAngle: plan.shellAngle },
              routes: { ...look.routes, edgeAngle: plan.routeAngle },
            };
          }

          pick = createFacePicker(batch, pickPriority);
          marked.clear();
          if (!sameEdges) {
            routeStamp = "";
            envelopeStamp = "";
            contextStamp = "";
          }
          routeGeometryDirty = true;
          byId.forEach((_, id) => tint(id));
          subjectBounds =
            boundsOfInstances(meshes, (i) => paintOf(i, paintBy).tier !== "context") ??
            (preserveLayers ? subjectBounds : null);
          limits = subjectBounds
            ? cameraBounds(subjectBounds, look.camera.zoomOutFactor, look.camera.panMargin)
            : null;
          returning = null;
          applyStage();
          paintNow(...painted);
          rebuildCaps();
          thumbsStale = true;
          moves.dispatchEvent({ type: "change" });
          mark("membership", { instances: byId.length, focus: byId.filter((i) => i.focus).length });
          accountGeometry();
          render();
        },
      };
    },
    canvas,
    gestureSize: () => [size.height, viewHeight(camera, controls.target)] as const,
    controls,
    moves,
    /** The camera the picture shows now: the orbit's, or the plane's. */
    active,
    pick(ray: THREE.Ray, clip?: (hit: Pick) => boolean) {
      const kept = (hit: Pick) => {
        if (!clipContains(clipVolume, hit.point, origin.toArray())) return false;
        if (paintOf(hit.instance, paintBy).tier === "context") {
          // Only the glass pane is a surface the pointer can meet; creases are not pickable.
          if (contextMode !== "glass") return false;
          const distance = veilDistance(field, hit.point);
          if (distance >= veil.veilFar.value) return false;
          const opacity =
            veil.veilFill.value *
            falloff(distance, veil.veilNear.value, veil.veilFar.value, veil.veilCurve.value);
          if (opacity < 0.004) return false;
        }
        return clip?.(hit) ?? true;
      };
      let hit = pick(ray, kept);
      capRay.ray.copy(ray);
      for (const [id, cap] of caps) {
        if (!cap.visible) continue;
        const point = capRay
          .intersectObject(cap, false)
          .find(({ point }) => kept({ instance: byId[id]!, point: point.toArray() }))?.point;
        if (!point) continue;
        const next: Pick = { instance: byId[id]!, point: point.toArray() };
        const rank = paints[id]!.tier === "context" ? 0 : 1;
        const prior = hit ? (paintOf(hit.instance, paintBy).tier === "context" ? 0 : 1) : -1;
        if (
          rank > prior ||
          (rank === prior &&
            point.distanceToSquared(ray.origin) <
              new THREE.Vector3(...hit!.point).distanceToSquared(ray.origin))
        )
          hit = next;
      }
      return hit;
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
        const hit = issueRay
          .intersectObject(group, true)
          .find((hit) => clipContains(clipVolume, hit.point.toArray(), origin.toArray()));
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
      placeViewport(limitViewport(v));
      if (plane) thumbsStale = true;
      render();
    },
    limitViewport,
    /** Preserve an existing picture across mesh replacement, then ease into the new subject. */
    recoverViewport(
      v: OrbitViewport,
      priorPlane: { axis: PlaneAxis; viewport: PlaneViewport } | null = null,
    ) {
      plane = priorPlane;
      controls.enabled = !plane;
      returnInside(v);
      placeViewport(limitViewport(v));
      render();
    },
    /** The plane picture's pose, or null while the orbit is shown. */
    plane: (): PlaneViewport | null => plane?.viewport ?? null,
    /** Show an axis orthographically (orbit controls off), or null for the orbit. */
    setPlane(next: { axis: PlaneAxis; viewport: PlaneViewport } | null) {
      if (next?.axis !== plane?.axis) thumbsStale = true;
      plane = next
        ? { ...next, viewport: boundPlane(next.axis, next.viewport, size, limits) }
        : null;
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
      const changedBounds =
        next.camera.zoomOutFactor !== look.camera.zoomOutFactor ||
        next.camera.panMargin !== look.camera.panMargin;
      look =
        next.shell.edgeAngle === look.shell.edgeAngle &&
        next.routes.edgeAngle === look.routes.edgeAngle
          ? next
          : {
              ...next,
              shell: { ...next.shell, edgeAngle: look.shell.edgeAngle },
              routes: { ...next.routes, edgeAngle: look.routes.edgeAngle },
            };
      applyLook();
      rebuildCaps();
      if (changedBounds) returnInside();
    },
    /** Purely visual: no capture or distance-field bake when a context layer changes. */
    setContextMode(mode: ContextMode = "glass", radiusFt?: number) {
      contextRadiusFt = radiusFt;
      contextMode = mode;
      setVeilLook(veil, look.veil, contextRadiusFt);
      syncContextLines();
      rebuildContextLines();
      thumbsStale = true;
      render();
    },
    /** Hue table and Colour dial: retint only, no capture or bake. */
    setHues(next: Kinds, mode: ColourMode) {
      kinds = next;
      colourMode = mode;
      huesStamp = JSON.stringify([next, mode]);
      routeGeometryDirty = true;
      byId.forEach((_, id) => tint(id, marked.get(id) ?? null));
      thumbsStale = true;
      render();
    },
    /** Presentation cannot change the accepted structural plan or start a worker. */
    setAppearance(plan: ScenePlan, next: PaintOf | undefined) {
      paintBy = planPaint(plan, next);
      routeGeometryDirty = true;
      byId.forEach((instance, id) => {
        const paint = paintOf(instance, paintBy);
        paints[id] = paint;
      });
      byId.forEach((_, id) => tint(id, marked.get(id) ?? null));
      caps.forEach((cap, id) =>
        cap.layers.set(
          paints[id]!.tier === "context"
            ? CONTEXT_LAYER
            : paints[id]!.tier === "envelope"
              ? SHELL_LAYER
              : 0,
        ),
      );
      paintNow(...painted);
      thumbsStale = true;
      render();
    },
    setClip(volume: ClipVolume | null | undefined, sourceBounds = meshes.bounds) {
      volume = rebaseClip(volume, center(sourceBounds), origin.toArray());
      layerRevision++;
      clipVolume = volume;
      uniforms.clipPolygon.value = volume?.data.length
        ? volume.data
        : new Float32Array(3 * CLIP_POINTS * 2);
      uniforms.clipCount.value = volume?.counts ?? [0, 0, 0];
      uniforms.clipKeep.value = (volume?.keepInside ?? [true, true, true]).map(Number);
      const planes = sectionPlanes(volume?.section ?? null);
      uniforms.sectionCount.value = planes.length;
      const packed = new Float32Array(24);
      planes.forEach((p, i) =>
        packed.set(
          [p[0]!, p[1]!, p[2]!, p[3]! + p[0]! * origin.x + p[1]! * origin.y + p[2]! * origin.z],
          i * 4,
        ),
      );
      uniforms.sectionPlane.value = packed;
      rebuildCaps();
      thumbsStale = true;
      render();
    },
    /** One group per key, rebuilt when its layer object is replaced, disposed when its key leaves. */
    setLayers(next: readonly Layer3D[] = []) {
      geometryAccountPending = true;
      // An equal layer list must not schedule three thumbnail renders and GPU readbacks.
      if (
        layers.size === next.length &&
        next.every((layer) => layers.get(layer.key)?.layer === layer)
      )
        return;
      if (damageBatch) {
        scene.remove(damageBatch.group);
        damageBatch.dispose();
      }
      if (markBatch) {
        scene.remove(markBatch.group);
        markBatch.dispose();
      }
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
            for (const m of [object.material].flat() as THREE.Material[]) {
              applyClip(m);
              veilMaterial(m, veil);
            }
        });
        scene.add(group);
        layers.set(layer.key, { layer, group });
        if (layer.targets?.length) reachOf.set(layer.key, segmentsOf(group));
      }
      damageBatch = next.some((layer) => layer.damage) ? createDamageBatch(next, occluded) : null;
      if (damageBatch) {
        damageBatch.group.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            applyClip(object.material);
            veilMaterial(object.material, veil);
          }
        });
        scene.add(damageBatch.group);
      }
      layerRevision++;
      markBatch = createMarkBatch(
        [...layers.values()].map(({ group }) => group),
        (material) => {
          applyClip(material);
          veilMaterial(material, veil);
        },
      );
      markBatch.sync();
      scene.add(markBatch.group);
      glowing = !!damageBatch;
      for (const { group } of layers.values())
        group.traverse((object) => void (glowing ||= object.layers.isEnabled(GLOW_LAYER)));
      fitLines(scene);
      thumbsStale = true;
      render();
    },
    dispose() {
      mark("dispose");
      api.clear();
      geometryMemory.release();
      onFrame = null;
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", motionChanged);
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
      if (markBatch) {
        scene.remove(markBatch.group);
        markBatch.dispose();
      }
      if (damageBatch) {
        scene.remove(damageBatch.group);
        damageBatch.dispose();
      }
      batch.disposeExcept();
      material.dispose();
      veil.veilField.value.dispose();
      contextDepth?.dispose();
      disposeTree(scene);
      scene.clear();
      glow.dispose();
      outline.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return api;
}

export type SceneRenderer = ReturnType<typeof createRenderer>;
