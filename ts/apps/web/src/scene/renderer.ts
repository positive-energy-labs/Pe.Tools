/**
 * The imperative core under `Scene3D`: one WebGLRenderer, one `BatchedMesh` for every element,
 * one perspective camera driven by OrbitControls, and one group per answer layer. No React. Cut
 * from the space spike's canvas; the cuts themselves stay in space and reach the shader only as
 * packed polygons (`setClip`).
 *
 * The batch holds positions relative to `origin` (the bounds centre) and sits at `origin`, so the
 * camera, controls, layers and raycast hits are all world feet while float32 vertices stay small.
 *
 * An axis picture (`setPlane`) swaps in one orthographic camera that pans and zooms only; the
 * perspective pose is untouched under it. Axis thumbnails (`setThumbs`) are drawn by this same
 * context into 2D canvases, only when what they show changed, never per orbit frame.
 */
import * as THREE from "three";
import { createMeshPicker } from "./picking";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { center, fromControls, toCamera, type OrbitViewport } from "./orbit";
import {
  fitPlane,
  frameRect,
  fromFrame,
  zoomPlane,
  type PlaneAxis,
  type PlaneViewport,
} from "./plane";
import {
  newCamera,
  projectThrough,
  rayThrough,
  type Project,
  type Ray,
  type Size,
} from "./projection";
import type { Layer3D, SceneInstance, SceneMeshes } from "./types";

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

/** A lit element (a hovered row elsewhere on the page) leans to this. */
const LIT = new THREE.Color(0xf2b544);
const MEP = /duct|pipe|conduit|tray|mechanical|plumbing|sprinkler|terminal|electrical/i;

/** Throws when WebGL is unavailable; the component says so. */
export function createRenderer(mount: HTMLElement, meshes: SceneMeshes) {
  const measuring = timing();
  mark("build-start", { instances: meshes.instances.length });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x202427);
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    "3D model. Left drag orbit, right drag pan, wheel zoom. Click an element to pick it; right click or BX shows it in Revit.",
  );
  canvas.tabIndex = 0;
  canvas.className = "block size-full";
  mount.prepend(canvas);

  const bounds = meshes.bounds;
  const origin = new THREE.Vector3(...center(bounds));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x69717b, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(1, -1, 3);
  scene.add(sun);
  const camera = newCamera();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
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
    const color = new THREE.Color(
      instance.focus || MEP.test(instance.category) ? 0xb5c9d2 : 0x747c81,
    );
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
        camera.aspect = at.width / at.height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        camera.aspect = size.width / size.height;
        camera.updateProjectionMatrix();
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
      if (thumbsStale) drawThumbs();
      renderer.render(scene, active());
      if (measuring) fence(started);
      tell();
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
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
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
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const k = Math.exp(-event.deltaY * 0.001);
    plane = {
      ...plane,
      viewport: zoomPlane(plane.viewport, k, event.clientX - rect.left, event.clientY - rect.top),
    };
    place(plane.axis, plane.viewport, size);
    render();
    moves.dispatchEvent({ type: "start" });
    moves.dispatchEvent({ type: "end" });
  };
  canvas.addEventListener("pointerdown", planeDown);
  window.addEventListener("pointermove", planeMove);
  window.addEventListener("pointerup", planeUp);
  canvas.addEventListener("wheel", planeWheel, { passive: false });
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();

  const layers = new Map<string, { layer: Layer3D; group: THREE.Group }>();
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

  return {
    canvas,
    camera,
    controls,
    moves,
    /** The camera the picture shows now: the orbit's, or the plane's. */
    active,
    batch,
    origin,
    byId,
    pick: createMeshPicker(batch, byId),
    render,
    viewport: (): OrbitViewport => fromControls(controls, bounds),
    setViewport(v: OrbitViewport) {
      const pose = toCamera(v, bounds);
      camera.position.fromArray(pose.position);
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
    paint(
      selected: ReadonlySet<string> | undefined,
      hidden: ReadonlySet<string> | undefined,
      isolated: ReadonlySet<string> | null | undefined,
      lit: ReadonlySet<string> | undefined,
    ) {
      byId.forEach(({ key }, id) => {
        batch.setVisibleAt(id, !hidden?.has(key) && (!isolated || isolated.has(key)));
        batch.setColorAt(
          id,
          selected?.has(key)
            ? colors[id]!.clone().multiplyScalar(1.6)
            : lit?.has(key)
              ? colors[id]!.clone().lerp(LIT, 0.55)
              : colors[id]!,
        );
      });
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
      for (const [key, held] of layers) {
        if (next.includes(held.layer)) continue;
        scene.remove(held.group);
        disposeTree(held.group);
        layers.delete(key);
      }
      for (const layer of next) {
        if (layers.has(layer.key)) continue;
        const group = new THREE.Group();
        group.name = layer.key;
        layer.build(group);
        scene.add(group);
        layers.set(layer.key, { layer, group });
      }
      thumbsStale = true;
      render();
    },
    dispose() {
      mark("dispose");
      onFrame = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", planeDown);
      window.removeEventListener("pointermove", planeMove);
      window.removeEventListener("pointerup", planeUp);
      canvas.removeEventListener("wheel", planeWheel);
      batch.dispose();
      scene.remove(batch);
      material.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export type SceneRenderer = ReturnType<typeof createRenderer>;
