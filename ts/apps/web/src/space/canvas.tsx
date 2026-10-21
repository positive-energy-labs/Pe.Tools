import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Button } from "@pe/kit/lang/button";
import { spaceMark, spaceTiming } from "./performance";
import {
  AXES,
  AXIS_LABEL,
  cutPolygon,
  cutPolygons,
  deleteNode,
  dragEdge,
  edgeCount,
  elementKey,
  emptyCut,
  frameRect,
  fromFrame,
  moveNode,
  nearestOnSegment,
  offsetCut,
  packPolygons,
  retained,
  toFrame,
  type Axis,
  type Cut,
  type Metadata,
  type Point,
  type Polygons,
  type ViewState,
} from "./state";

/** A right click on a cut: an edge offers Add node at `point`, a node offers Delete node. */
export type CutMenu = {
  axis: Axis;
  kind: "node" | "edge";
  index: number;
  point: Point;
  x: number;
  y: number;
};
type Props = {
  metadata: Metadata;
  positions: Float32Array;
  state: ViewState;
  /** The axis whose orthographic editor holds the main picture; null is the 3D view. */
  editing: Axis | null;
  onEdit: (axis: Axis | null) => void;
  /** Commit one axis cut (null clears it). False when rejected; the route shows why. */
  onCut: (axis: Axis, cut: Cut | null) => boolean;
  onChange: (change: Partial<ViewState>) => boolean;
  onMenu: (menu: CutMenu) => void;
  onError: (message: string) => void;
};

/** The three floaters, stacked in the bottom right corner like the ducts corner picture. */
const FLOAT = { width: 216, height: 136, margin: 8 } as const;
const MILD: Record<Axis, number> = { top: 0x6f9bc4, north: 0xc49a6f, east: 0x7fb87f };
const PAD = 0.1;
const NODE_PX = 10;

// One canonical cut per axis; the retained volume is their intersection. Even-odd membership keeps
// concave prisms. `frameOf` repeats `toFrame` in state.ts; packPolygons feeds the same numbers.
const clipping = `
varying vec3 vSpacePosition;
uniform vec4 spacePolygon[96];
uniform int spaceCount[3];
uniform int spaceKeep[3];
vec2 spacePoint(int a, int i) {
  vec4 q = spacePolygon[a * 32 + i / 2];
  return (i % 2 == 0) ? q.xy : q.zw;
}
vec2 frameOf(int a, vec3 p) { return a == 0 ? p.xy : a == 1 ? vec2(-p.x, p.z) : p.yz; }
void spaceClip() {
  for (int a = 0; a < 3; a++) {
    int n = spaceCount[a];
    if (n < 3) continue;
    vec2 q = frameOf(a, vSpacePosition);
    bool inside = false;
    for (int i = 0; i < 64; i++) {
      if (i >= n) break;
      vec2 A = spacePoint(a, i), B = spacePoint(a, i == 0 ? n - 1 : i - 1);
      if ((A.y > q.y) != (B.y > q.y) && q.x < (B.x - A.x) * (q.y - A.y) / (B.y - A.y) + A.x)
        inside = !inside;
    }
    if (inside != (spaceKeep[a] == 1)) discard;
  }
}`;

type Grip = { axis: Axis; kind: "node" | "edge"; index: number };
type Drag = Grip & {
  pointerId: number;
  start: Point;
  base: Cut;
  draft: Cut;
  /** Node drag: the neighbour it snapped onto; release merges into it. */
  merge: number | null;
  /** Edge drag: pushed past its neighbours' meeting point; release leaves one corner node. */
  collapsed: boolean;
};

export function SpaceCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const update = useRef<(() => void) | null>(null);
  useEffect(() => {
    const sceneId = props.state.scene;
    const measuring = spaceTiming();
    spaceMark("build-start", { id: sceneId });
    const mount = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
      latest.current.onError(`WebGL unavailable: ${String(error)}`);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x202427);
    renderer.domElement.setAttribute(
      "aria-label",
      "Space 3D mesh. Left drag orbit, right drag pan, wheel zoom. Click an element to select. Drag a cut node or edge grip to edit; right click a cut for node actions.",
    );
    renderer.domElement.tabIndex = 0;
    renderer.domElement.className = "block size-full";
    mount.prepend(renderer.domElement);
    const bounds = props.metadata.bounds;
    const scene = new THREE.Scene();
    const origin = new THREE.Vector3().fromArray(props.state.target);
    const o = origin.toArray();
    const rects = Object.fromEntries(AXES.map((a) => [a, frameRect(a, bounds)])) as Record<
      Axis,
      ReturnType<typeof frameRect>
    >;
    /** A frame point (u, v, w) in scene-local coordinates. */
    const local = (axis: Axis, u: number, v: number, w: number) =>
      new THREE.Vector3(...fromFrame(axis, u, v, w)).sub(origin);
    const perspective = new THREE.PerspectiveCamera(45, 1, 0.05, 100000);
    perspective.up.set(0, 0, 1);
    const orbit = new OrbitControls(perspective, renderer.domElement);
    orbit.enableDamping = false;
    orbit.screenSpacePanning = true;
    // One orthographic camera per axis: the floater's picture, and the editor when swapped in.
    // Its controls pan and zoom only, so the 3D orbit pose is untouched while editing.
    const ortho = Object.fromEntries(
      AXES.map((axis) => {
        const r = rects[axis],
          depth = r.w1 - r.w0 + Math.max(r.u1 - r.u0, r.v1 - r.v0) + 10;
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, depth * 3);
        camera.up.copy(local(axis, 0, 1, 0).add(origin).normalize());
        const controls = new OrbitControls(camera, renderer.domElement);
        Object.assign(controls, { enableRotate: false, enableDamping: false, enabled: false });
        controls.screenSpacePanning = true;
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
        return [axis, { camera, controls, depth }];
      }),
    ) as Record<
      Axis,
      {
        camera: THREE.OrthographicCamera;
        controls: OrbitControls<THREE.OrthographicCamera>;
        depth: number;
      }
    >;
    const fit = (axis: Axis, width: number, height: number) => {
      const { camera, controls, depth } = ortho[axis],
        r = rects[axis];
      const cu = (r.u0 + r.u1) / 2,
        cv = (r.v0 + r.v1) / 2;
      const half = Math.max((r.u1 - r.u0) / 2, ((r.v1 - r.v0) / 2) * (width / Math.max(height, 1)));
      const scale = half * 1.12 || 1;
      Object.assign(camera, {
        left: -scale,
        right: scale,
        top: (scale * height) / Math.max(width, 1),
        bottom: (-scale * height) / Math.max(width, 1),
        zoom: 1,
      });
      camera.position.copy(local(axis, cu, cv, r.w1 + depth));
      controls.target.copy(local(axis, cu, cv, r.w1));
      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
      controls.update();
    };
    scene.add(new THREE.HemisphereLight(0xffffff, 0x69717b, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(1, -1, 3);
    scene.add(sun);
    const uniforms = {
      spacePolygon: { value: new Float32Array(96 * 4) },
      spaceCount: { value: [0, 0, 0] },
      spaceKeep: { value: [1, 1, 1] },
    };
    const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[] = [];
    for (const element of props.metadata.elements) {
      const geometry = new THREE.BufferGeometry();
      const vertices = props.positions.slice(
        element.firstVertex * 3,
        (element.firstVertex + element.vertexCount) * 3,
      );
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i]! -= origin.x;
        vertices[i + 1]! -= origin.y;
        vertices[i + 2]! -= origin.z;
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      const mep =
        element.focus ||
        /duct|pipe|conduit|tray|mechanical|plumbing|sprinkler|terminal|electrical/i.test(
          element.handle.category,
        );
      const material = new THREE.MeshLambertMaterial({
        color: mep ? 0xb5c9d2 : 0x747c81,
        side: THREE.DoubleSide,
      });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = `varying vec3 vSpacePosition;\n${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvSpacePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
        shader.fragmentShader = `${clipping}\n${shader.fragmentShader}`.replace(
          "#include <clipping_planes_fragment>",
          "#include <clipping_planes_fragment>\nspaceClip();",
        );
      };
      material.customProgramCacheKey = () => "space-axes-v2";
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.key = elementKey(element);
      scene.add(mesh);
      meshes.push(mesh);
    }
    spaceMark("geometry", { id: sceneId, meshes: meshes.length });
    // Per axis: its bounds frame (always shown, so an empty axis stays reachable), its cut, and
    // the cut's offset shift. All float on the frame's +w face, above the scene.
    const overlay = <T extends THREE.Line | THREE.Points | THREE.Mesh>(object: T) => {
      object.renderOrder = 10;
      scene.add(object);
      return object;
    };
    const line = (color: number, loop = false) =>
      overlay(
        new (loop ? THREE.LineLoop : THREE.Line)(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
        ),
      );
    const frames = Object.fromEntries(AXES.map((a) => [a, line(MILD[a], true)])) as Record<
      Axis,
      THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    >;
    const cutLines = Object.fromEntries(AXES.map((a) => [a, line(MILD[a])])) as Record<
      Axis,
      THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    >;
    const offsetLines = Object.fromEntries(AXES.map((a) => [a, line(0x8fd3ff)])) as Record<
      Axis,
      THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    >;
    const gripPoints = (size: number) =>
      overlay(
        new THREE.Points(
          new THREE.BufferGeometry(),
          new THREE.PointsMaterial({
            size,
            sizeAttenuation: false,
            vertexColors: true,
            depthTest: false,
          }),
        ),
      );
    const nodes = gripPoints(9),
      mids = gripPoints(7);
    // The curtain is the cutting surface itself: the draft cut extruded across the scene's extent.
    const curtain = overlay(
      new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: 0x9fd0ff,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    curtain.renderOrder = 5;
    curtain.material.opacity = 0.16;
    const setPoints = (object: THREE.Line | THREE.Points | THREE.Mesh, points: THREE.Vector3[]) => {
      object.geometry.dispose();
      object.geometry = new THREE.BufferGeometry().setFromPoints(points);
      object.visible = points.length > 0;
    };
    for (const axis of AXES) {
      const r = rects[axis],
        w = r.w1 + PAD;
      setPoints(frames[axis], [
        local(axis, r.u0, r.v0, w),
        local(axis, r.u1, r.v0, w),
        local(axis, r.u1, r.v1, w),
        local(axis, r.u0, r.v1, w),
      ]);
      frames[axis].material.opacity = 0.45;
    }
    // Floater pictures are cached in render targets and only re-rendered when what they show
    // changes; every frame blits them, so an orbit frame costs one scene pass plus three quads.
    const targets = Object.fromEntries(
      AXES.map((a) => [a, new THREE.WebGLRenderTarget(1, 1, { samples: 4 })]),
    ) as Record<Axis, THREE.WebGLRenderTarget>;
    const stale = new Set<Axis>(AXES);
    const blit = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: targets.top.texture }),
    );
    const blitScene = new THREE.Scene().add(blit);
    const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    let polygons: Polygons = { top: [], north: [], east: [] };
    let drag: Drag | null = null;
    // A committed draft stays drawn until the state carrying it syncs; a rejected one snaps back.
    let held: { axis: Axis; cut: Cut } | null = null;
    let hot: Grip | null = null;
    let menuDown: [number, number] | null = null;
    let shown: ViewState | null = null;
    let shownEditing: Axis | null = null;
    const published = new WeakSet<object>();
    let frame = 0;
    let size = { width: 1, height: 1 };
    const floater = (k: number) => ({
      x: size.width - FLOAT.margin - FLOAT.width,
      y: size.height - (AXES.length - k) * (FLOAT.height + FLOAT.margin),
      width: FLOAT.width,
      height: FLOAT.height,
    });
    const mainCamera = () => {
      const editing = latest.current.editing;
      return editing ? ortho[editing].camera : perspective;
    };
    const cutOf = (axis: Axis) =>
      drag?.axis === axis
        ? drag.draft
        : held?.axis === axis
          ? held.cut
          : latest.current.state.cuts[axis];
    /** Axes whose grips the main picture offers: the edited axis alone, or every drawn cut in 3D. */
    const interactive = () => {
      const editing = latest.current.editing;
      return editing ? [editing] : AXES.filter((a) => edgeCount(cutOf(a)) > 0);
    };
    // OrbitControls fires per pointer move; coalesce those and every state change into one frame.
    const render = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const started = performance.now();
        if (measuring) {
          renderer.info.autoReset = false;
          renderer.info.reset();
        }
        const editing = latest.current.editing;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.width, size.height);
        nodes.visible = mids.visible = true;
        renderer.render(scene, mainCamera());
        nodes.visible = mids.visible = false;
        const curtainShown = curtain.visible;
        curtain.visible = false;
        for (const axis of stale) {
          renderer.setRenderTarget(targets[axis]);
          if (axis !== editing) renderer.render(scene, ortho[axis].camera);
          else {
            // The swapped floater shows the saved 3D pose at the floater's own aspect.
            perspective.aspect = FLOAT.width / FLOAT.height;
            perspective.updateProjectionMatrix();
            renderer.render(scene, perspective);
            perspective.aspect = size.width / Math.max(size.height, 1);
            perspective.updateProjectionMatrix();
          }
        }
        stale.clear();
        curtain.visible = curtainShown;
        renderer.setRenderTarget(null);
        renderer.setScissorTest(true);
        AXES.forEach((axis, k) => {
          const r = floater(k),
            y = size.height - r.y - r.height;
          renderer.setViewport(r.x, y, r.width, r.height);
          renderer.setScissor(r.x, y, r.width, r.height);
          blit.material.map = targets[axis].texture;
          renderer.render(blitScene, blitCamera);
        });
        if (measuring) {
          const info = renderer.info;
          const gl = renderer.getContext() as WebGL2RenderingContext;
          spaceMark("submitted", { id: sceneId, cpuMs: performance.now() - started,
            calls: info.render.calls, triangles: info.render.triangles,
            geometries: info.memory.geometries, textures: info.memory.textures });
          const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const complete = () => {
            if (!fence || gl.isContextLost()) return;
            const status = gl.clientWaitSync(fence, 0, 0);
            if (status === gl.TIMEOUT_EXPIRED) {
              requestAnimationFrame(complete);
              return;
            }
            gl.deleteSync(fence);
            spaceMark("gpu-complete", { id: sceneId, status });
          };
          requestAnimationFrame(complete);
        }
      });
    };
    const upload = () => {
      const packed = packPolygons(polygons, latest.current.state.cuts, o);
      uniforms.spacePolygon.value = packed.data;
      uniforms.spaceCount.value = packed.counts;
      uniforms.spaceKeep.value = packed.keepInside.map(Number);
    };
    const curtainFor = (axis: Axis | null) => {
      const cut = axis && cutOf(axis);
      if (!axis || !cut || edgeCount(cut) === 0) return setPoints(curtain, []);
      let path: Point[];
      try {
        const offset = offsetCut(cut),
          polygon = cutPolygon(cut, rects[axis]);
        path = cut.closed ? [...offset, offset[0]!] : polygon.slice(0, offset.length + 2);
      } catch {
        return setPoints(curtain, []);
      }
      const r = rects[axis],
        w0 = r.w0 - PAD,
        w1 = r.w1 + PAD;
      const quads: THREE.Vector3[] = [];
      for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1]!, path[i]!];
        const [a0, a1, b0, b1] = [
          local(axis, a[0], a[1], w0),
          local(axis, a[0], a[1], w1),
          local(axis, b[0], b[1], w0),
          local(axis, b[0], b[1], w1),
        ];
        quads.push(a0, b0, b1, a0, b1, a1);
      }
      setPoints(curtain, quads);
    };
    // Drafts preview live (shader, lines, curtain); only a committed, valid cut reaches state.
    const drawCuts = () => {
      const editing = latest.current.editing;
      for (const axis of AXES) {
        const cut = cutOf(axis),
          w = rects[axis].w1 + PAD;
        let valid = true;
        try {
          polygons = { ...polygons, [axis]: cutPolygon(cut, rects[axis]) };
        } catch {
          valid = false;
        }
        const pts = cut.polyline.map((p) => local(axis, p[0], p[1], w));
        const emphasis = editing === axis || drag?.axis === axis || hot?.axis === axis;
        cutLines[axis].material.color.setHex(
          !valid
            ? 0xff5c5c
            : drag?.axis === axis && (drag.collapsed || drag.merge !== null)
              ? 0xffd27a
              : emphasis
                ? 0xffffff
                : MILD[axis],
        );
        setPoints(cutLines[axis], pts.length > 1 ? (cut.closed ? [...pts, pts[0]!] : pts) : []);
        let shifted: THREE.Vector3[] = [];
        if (valid && cut.offset !== 0 && pts.length > 1)
          shifted = offsetCut(cut).map((p) => local(axis, p[0], p[1], w));
        setPoints(
          offsetLines[axis],
          cut.closed && shifted.length ? [...shifted, shifted[0]!] : shifted,
        );
      }
      upload();
      const nodePts: THREE.Vector3[] = [],
        nodeColors: number[] = [],
        midPts: THREE.Vector3[] = [],
        midColors: number[] = [];
      const lit = (g: Grip) =>
        (drag && drag.axis === g.axis && drag.kind === g.kind && drag.index === g.index) ||
        (hot && hot.axis === g.axis && hot.kind === g.kind && hot.index === g.index);
      for (const axis of interactive()) {
        const cut = cutOf(axis),
          w = rects[axis].w1 + PAD,
          n = cut.polyline.length;
        cut.polyline.forEach((p, i) => {
          nodePts.push(local(axis, p[0], p[1], w));
          const merging = drag?.axis === axis && drag.merge === i;
          nodeColors.push(
            ...(merging
              ? [1, 0.48, 0.36]
              : lit({ axis, kind: "node", index: i })
                ? [1, 0.82, 0.4]
                : [0.92, 0.92, 0.92]),
          );
        });
        for (let i = 0; i < edgeCount(cut); i++) {
          const a = cut.polyline[i]!,
            b = cut.polyline[(i + 1) % n]!;
          midPts.push(local(axis, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, w));
          midColors.push(
            ...(lit({ axis, kind: "edge", index: i }) ? [1, 0.82, 0.4] : [0.6, 0.64, 0.67]),
          );
        }
      }
      setPoints(nodes, nodePts);
      nodes.geometry.setAttribute("color", new THREE.Float32BufferAttribute(nodeColors, 3));
      setPoints(mids, midPts);
      mids.geometry.setAttribute("color", new THREE.Float32BufferAttribute(midColors, 3));
      curtainFor(drag?.axis ?? hot?.axis ?? null);
      render();
    };
    const resize = () => {
      size = { width: mount.clientWidth, height: mount.clientHeight };
      renderer.setSize(size.width, size.height, false);
      perspective.aspect = size.width / Math.max(size.height, 1);
      perspective.updateProjectionMatrix();
      const ratio = renderer.getPixelRatio();
      for (const axis of AXES) {
        targets[axis].setSize(FLOAT.width * ratio, FLOAT.height * ratio);
        if (axis === latest.current.editing) fit(axis, size.width, size.height);
        else fit(axis, FLOAT.width, FLOAT.height);
        stale.add(axis);
      }
      render();
    };
    const sync = () => {
      const s = latest.current.state,
        was = shown,
        editing = latest.current.editing;
      shown = s;
      held = null;
      // The camera is applied only when it changed outside this canvas. Any pose this canvas
      // published is already behind the camera; re-applying it fights the gesture that followed.
      if (
        (s.camera !== was?.camera || s.target !== was?.target) &&
        !(published.has(s.camera) && published.has(s.target))
      ) {
        perspective.position.fromArray(s.camera).sub(origin);
        orbit.target.fromArray(s.target).sub(origin);
        orbit.update();
      }
      if (
        s.hidden !== was?.hidden ||
        s.isolated !== was?.isolated ||
        s.selected !== was?.selected
      ) {
        const hidden = new Set(s.hidden),
          isolated = s.isolated && new Set(s.isolated);
        for (const mesh of meshes) {
          const key = mesh.userData.key as string;
          mesh.visible = !hidden.has(key) && (!isolated || isolated.has(key));
          mesh.material.emissive.setHex(s.selected === key ? 0x666666 : 0x000000);
        }
      }
      if (editing !== shownEditing) {
        if (shownEditing) fit(shownEditing, FLOAT.width, FLOAT.height);
        if (editing) fit(editing, size.width, size.height);
        shownEditing = editing;
        hot = null;
      }
      orbit.enabled = !editing && !drag;
      for (const axis of AXES) ortho[axis].controls.enabled = axis === editing && !drag;
      try {
        polygons = cutPolygons(s.cuts, bounds);
      } catch {
        // An invalid committed cut never reaches state; keep the last drawn polygons.
      }
      for (const axis of AXES) stale.add(axis);
      drawCuts();
    };
    update.current = sync;
    // OrbitControls owns the gesture; the durable pose is published once it ends.
    const publish = () => {
      const pose: [ViewState["camera"], ViewState["target"]] = [
        perspective.position.clone().add(origin).toArray() as ViewState["camera"],
        orbit.target.clone().add(origin).toArray() as ViewState["target"],
      ];
      const s = latest.current.state;
      if (pose[0].every((v, i) => v === s.camera[i]) && pose[1].every((v, i) => v === s.target[i]))
        return;
      published.add(pose[0]).add(pose[1]);
      latest.current.onChange({ camera: pose[0], target: pose[1] });
    };
    orbit.addEventListener("change", render);
    orbit.addEventListener("end", publish);
    for (const axis of AXES) ortho[axis].controls.addEventListener("change", render);
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const ray = new THREE.Raycaster();
    const pointer = (event: PointerEvent | MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - r.left) / r.width) * 2 - 1,
          1 - ((event.clientY - r.top) / r.height) * 2,
        ),
        mainCamera(),
      );
    };
    /** The pointer on an axis's editing plane, in frame (u, v). A grazing ray returns null (the
     * caller keeps its last point) and hits are clamped near the frame, never launched to infinity. */
    const planePoint = (axis: Axis, event: PointerEvent | MouseEvent): Point | null => {
      pointer(event);
      const normal = local(axis, 0, 0, 1).add(origin).normalize();
      if (Math.abs(ray.ray.direction.dot(normal)) < 0.03) return null;
      const r = rects[axis];
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        local(axis, 0, 0, r.w1 + PAD),
      );
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const [u, v] = toFrame(axis, hit.add(origin).toArray());
      const m = Math.max(r.u1 - r.u0, r.v1 - r.v0, 1);
      return [Math.min(Math.max(u, r.u0 - m), r.u1 + m), Math.min(Math.max(v, r.v0 - m), r.v1 + m)];
    };
    const screen = (axis: Axis, p: Point) => {
      const s = local(axis, p[0], p[1], rects[axis].w1 + PAD).project(mainCamera());
      return {
        x: ((s.x + 1) * size.width) / 2,
        y: ((1 - s.y) * size.height) / 2,
        front: s.z < 1,
      };
    };
    const offsetOf = (event: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return [event.clientX - r.left, event.clientY - r.top] as const;
    };
    /** Nearest node grip, then nearest edge midpoint grip, within reach of the pointer. */
    const gripAt = (event: MouseEvent, edges: "midpoint" | "segment" = "midpoint"): Grip | null => {
      const [x, y] = offsetOf(event);
      let best: Grip | null = null,
        reach: number = NODE_PX;
      for (const axis of interactive()) {
        const { polyline } = cutOf(axis);
        for (let index = 0; index < polyline.length; index++) {
          const s = screen(axis, polyline[index]!),
            d = Math.hypot(s.x - x, s.y - y);
          if (s.front && d < reach) [best, reach] = [{ axis, kind: "node", index }, d];
        }
      }
      if (best) return best;
      reach = edges === "midpoint" ? NODE_PX : 8;
      for (const axis of interactive()) {
        const cut = cutOf(axis),
          n = cut.polyline.length;
        for (let index = 0; index < edgeCount(cut); index++) {
          const a = screen(axis, cut.polyline[index]!),
            b = screen(axis, cut.polyline[(index + 1) % n]!);
          if (!a.front || !b.front) continue;
          const near =
            edges === "midpoint"
              ? [(a.x + b.x) / 2, (a.y + b.y) / 2]
              : nearestOnSegment([x, y], [a.x, a.y], [b.x, b.y]);
          const d = Math.hypot(near[0]! - x, near[1]! - y);
          if (d < reach) [best, reach] = [{ axis, kind: "edge", index }, d];
        }
      }
      return best;
    };
    const controlsFree = (free: boolean) => {
      const editing = latest.current.editing;
      orbit.enabled = free && !editing;
      for (const axis of AXES) ortho[axis].controls.enabled = free && axis === editing;
    };
    const endDrag = () => {
      if (drag && renderer.domElement.hasPointerCapture(drag.pointerId))
        renderer.domElement.releasePointerCapture(drag.pointerId);
      drag = null;
      controlsFree(true);
    };
    let down = [0, 0];
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
      if (event.button === 2) menuDown = [event.clientX, event.clientY];
      if (event.button !== 0) return;
      const grip = gripAt(event);
      const start = grip && planePoint(grip.axis, event);
      if (!grip || !start) return;
      const base = latest.current.state.cuts[grip.axis];
      drag = {
        ...grip,
        pointerId: event.pointerId,
        start,
        base,
        draft: base,
        merge: null,
        collapsed: false,
      };
      controlsFree(false);
      renderer.domElement.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
      drawCuts();
    };
    const pointerMove = (event: PointerEvent) => {
      if (drag) {
        event.stopImmediatePropagation();
        const p = planePoint(drag.axis, event);
        if (!p) return;
        if (drag.kind === "edge") {
          const folded = dragEdge(drag.base, drag.index, [
            p[0] - drag.start[0],
            p[1] - drag.start[1],
          ]);
          drag.draft = folded.cut;
          drag.collapsed = folded.collapsed;
        } else {
          // A node within reach of a neighbour snaps onto it; release merges the two.
          const { polyline, closed } = drag.base,
            n = polyline.length,
            [x, y] = offsetOf(event);
          const neighbours = [drag.index - 1, drag.index + 1]
            .filter((k) => closed || (k >= 0 && k < n))
            .map((k) => (k + n) % n);
          drag.merge =
            neighbours.find((k) => {
              const s = screen(drag!.axis, polyline[k]!);
              return Math.hypot(s.x - x, s.y - y) < NODE_PX;
            }) ?? null;
          drag.draft = moveNode(
            drag.base,
            drag.index,
            drag.merge === null ? p : polyline[drag.merge]!,
          );
        }
        drawCuts();
      } else if (event.buttons === 0) {
        const next = gripAt(event);
        renderer.domElement.style.cursor = next ? "grab" : "";
        if (next?.axis !== hot?.axis || next?.kind !== hot?.kind || next?.index !== hot?.index) {
          hot = next;
          drawCuts();
        }
      }
    };
    const pointerUp = (event: PointerEvent) => {
      if (drag) {
        event.stopImmediatePropagation();
        const { axis, kind, index, base, draft, merge } = drag;
        endDrag();
        const moved = Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 2;
        let committed: Cut | null | string = draft;
        if (kind === "node" && merge !== null) committed = deleteNode(base, index);
        if (typeof committed === "string") latest.current.onError(committed);
        else if ((moved || merge !== null) && latest.current.onCut(axis, committed))
          held = { axis, cut: committed ?? emptyCut };
        drawCuts();
        return;
      }
      if (event.button !== 0 || Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 5)
        return;
      pointer(event);
      const hits = ray
        .intersectObjects(meshes.filter((mesh) => mesh.visible))
        .filter(
          (h) =>
            h.object.visible &&
            retained(h.point.clone().add(origin).toArray(), latest.current.state.cuts, polygons),
        );
      latest.current.onChange({
        selected: (hits[0]?.object.userData.key as string | undefined) ?? null,
      });
    };
    // A cancelled or stolen pointer abandons the draft; the controls never stay disabled.
    const pointerCancel = () => {
      if (!drag) return;
      endDrag();
      drawCuts();
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const start = menuDown;
      menuDown = null;
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
      const grip = gripAt(event, "segment");
      if (!grip) return;
      const cut = cutOf(grip.axis),
        n = cut.polyline.length;
      const at = planePoint(grip.axis, event);
      const point =
        grip.kind === "node"
          ? cut.polyline[grip.index]!
          : at
            ? nearestOnSegment(at, cut.polyline[grip.index]!, cut.polyline[(grip.index + 1) % n]!)
            : null;
      if (!point) return;
      const [x, y] = offsetOf(event);
      latest.current.onMenu({ ...grip, point, x, y });
    };
    const pointerLeave = () => {
      if (drag || !hot) return;
      hot = null;
      drawCuts();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", pointerDown, true);
    canvas.addEventListener("pointermove", pointerMove, true);
    canvas.addEventListener("pointerup", pointerUp, true);
    canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("lostpointercapture", pointerCancel);
    canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("pointerleave", pointerLeave);
    resize();
    sync();
    return () => {
      update.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      orbit.dispose();
      for (const axis of AXES) {
        ortho[axis].controls.dispose();
        targets[axis].dispose();
      }
      canvas.removeEventListener("pointerdown", pointerDown, true);
      canvas.removeEventListener("pointermove", pointerMove, true);
      canvas.removeEventListener("pointerup", pointerUp, true);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("pointerleave", pointerLeave);
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.Line ||
          object instanceof THREE.Points
        ) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      blit.geometry.dispose();
      blit.material.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [props.metadata, props.positions]);
  useEffect(() => {
    update.current?.();
  }, [props.state, props.editing]);
  return (
    <div ref={host} className="absolute inset-0 min-h-0 overflow-hidden">
      {AXES.map((axis, k) => {
        const swapped = props.editing === axis;
        return (
          <div
            key={axis}
            className="absolute hairline t-small"
            style={{
              right: FLOAT.margin,
              bottom: (AXES.length - 1 - k) * (FLOAT.height + FLOAT.margin) + FLOAT.margin,
              width: FLOAT.width,
              height: FLOAT.height,
            }}
            data-space-floater={axis}
          >
            <Button
              kind="quiet"
              label={swapped ? "Return to the 3D view (Esc)" : `Edit the ${AXIS_LABEL[axis]} cut`}
              pressed={swapped}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              onClick={() => props.onEdit(swapped ? null : axis)}
            >
              <span className="absolute left-1 top-1 px-1" data-surface="page">
                {swapped ? "3D · Esc" : AXIS_LABEL[axis]}
                {!swapped && props.state.cuts[axis].polyline.length === 0 ? " · no cut" : ""}
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
