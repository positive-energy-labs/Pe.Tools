import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  cutPolygon,
  elementKey,
  offsetCut,
  retained,
  type Metadata,
  type ViewState,
} from "./state";

type Props = {
  metadata: Metadata;
  positions: Float32Array;
  state: ViewState;
  drawing: "straight" | "bent" | null;
  /** False when the patch is rejected (an invalid cut); the route then shows why. */
  onChange: (change: Partial<ViewState>) => boolean;
  onDraw: (point: [number, number]) => void;
  onError: (message: string) => void;
};

// Even-odd polygon membership preserves concave prisms. A plane intersection would convexify a bent cut.
const clipping = `
varying vec3 vSpacePosition;
uniform vec4 spacePlane;
uniform bool spacePlaneOn;
uniform vec2 spacePolygon[64];
uniform int spacePolygonCount;
uniform bool spaceKeepInside;
void spaceClip() {
  if (spacePlaneOn && dot(spacePlane.xyz, vSpacePosition) + spacePlane.w < 0.0) discard;
  if (spacePolygonCount < 3) return;
  bool inside = false;
  for (int i = 0; i < 64; i++) {
    if (i >= spacePolygonCount) break;
    int j = i == 0 ? spacePolygonCount - 1 : i - 1;
    vec2 a = spacePolygon[i], b = spacePolygon[j];
    if ((a.y > vSpacePosition.y) != (b.y > vSpacePosition.y)) {
      if (vSpacePosition.x < (b.x-a.x)*(vSpacePosition.y-a.y)/(b.y-a.y)+a.x) inside = !inside;
    }
  }
  if (inside != spaceKeepInside) discard;
}`;

export function SpaceCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const update = useRef<(() => void) | null>(null);
  useEffect(() => {
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
      "Space 3D mesh. Left drag orbit, right drag pan, wheel zoom. Click an element to select; drag square cut handles to edit the cut.",
    );
    renderer.domElement.tabIndex = 0;
    renderer.domElement.className = "block size-full";
    mount.append(renderer.domElement);
    const scene = new THREE.Scene();
    const origin = new THREE.Vector3().fromArray(props.state.target);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x69717b, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(1, -1, 3);
    scene.add(sun);
    const uniforms = {
      spacePlane: { value: new THREE.Vector4() },
      spacePlaneOn: { value: false },
      spacePolygon: { value: Array.from({ length: 64 }, () => new THREE.Vector2()) },
      spacePolygonCount: { value: 0 },
      spaceKeepInside: { value: true },
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
      material.customProgramCacheKey = () => "space-prism-v1";
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.key = elementKey(element);
      scene.add(mesh);
      meshes.push(mesh);
    }
    // The drawn cut, its offset shift, and square vertex handles float just above the scene.
    const cutLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    const offsetLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x8fd3ff, depthTest: false }),
    );
    const handles = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: 9,
        sizeAttenuation: false,
        vertexColors: true,
        depthTest: false,
      }),
    );
    for (const overlay of [cutLine, offsetLine, handles]) {
      overlay.renderOrder = 10;
      scene.add(overlay);
    }
    let dragged: number | null = null;
    let draft: [number, number][] | null = null;
    let hover: [number, number] | null = null;
    let hot: number | null = null;
    let polygon: [number, number][] = [];
    let shown: ViewState | null = null;
    const published = new WeakSet<object>();
    let frame = 0;
    const drawingZ = props.metadata.bounds.maxZ - origin.z + 0.1;
    // OrbitControls fires per pointer move; coalesce those and every state change into one frame.
    const render = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };
    const local = (points: [number, number][], closed: boolean) => {
      const v = points.map((p) => new THREE.Vector3(p[0] - origin.x, p[1] - origin.y, drawingZ));
      return closed && v.length > 2 ? [...v, v[0]!] : v;
    };
    const setGeometry = (object: THREE.Line | THREE.Points, points: THREE.Vector3[]) => {
      object.geometry.dispose();
      object.geometry = new THREE.BufferGeometry().setFromPoints(points);
      object.visible = points.length > 0;
    };
    // Draft (drag) and hover (rubberband) previews clip live; only a valid committed cut reaches state.
    const drawCut = () => {
      const s = latest.current.state,
        drawing = latest.current.drawing;
      const points = draft ?? s.polyline;
      const closing = drawing === "bent" && points.length >= 3 && hover === points[0];
      const cut = {
        polyline: drawing && hover && !closing ? [...points, hover] : points,
        closed: closing || (s.closed && !drawing),
        offset: s.offset,
      };
      let valid = true;
      try {
        polygon = cutPolygon(cut, props.metadata.bounds);
        uniforms.spacePolygonCount.value = polygon.length;
        polygon.forEach((v, i) =>
          uniforms.spacePolygon.value[i]!.set(v[0] - origin.x, v[1] - origin.y),
        );
      } catch {
        valid = false;
      }
      uniforms.spaceKeepInside.value = s.keepInside;
      cutLine.material.color.setHex(valid ? 0xffffff : 0xff5c5c);
      setGeometry(cutLine, cut.polyline.length > 1 ? local(cut.polyline, cut.closed) : []);
      setGeometry(
        offsetLine,
        valid && cut.offset !== 0 && cut.polyline.length > 1
          ? local(offsetCut(cut), cut.closed)
          : [],
      );
      setGeometry(handles, local(points, false));
      handles.geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          points.flatMap((_, i) => (i === (dragged ?? hot) ? [1, 0.82, 0.4] : [1, 1, 1])),
          3,
        ),
      );
      render();
    };
    const sync = () => {
      const s = latest.current.state,
        was = shown;
      shown = s;
      // The camera is applied only when it changed outside this canvas. Any pose this canvas
      // published is already behind the camera; re-applying it fights the gesture that followed.
      if (
        (s.camera !== was?.camera || s.target !== was?.target) &&
        !(published.has(s.camera) && published.has(s.target))
      ) {
        camera.position.fromArray(s.camera).sub(origin);
        controls.target.fromArray(s.target).sub(origin);
        controls.update();
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
      const p = s.plane;
      uniforms.spacePlaneOn.value = p !== null;
      if (p)
        uniforms.spacePlane.value.set(
          p[0],
          p[1],
          p[2],
          p[3] + p[0] * origin.x + p[1] * origin.y + p[2] * origin.z,
        );
      if (!latest.current.drawing) hover = null;
      if (dragged === null) draft = null;
      controls.enabled = latest.current.drawing === null && dragged === null;
      drawCut();
    };
    update.current = sync;
    // OrbitControls owns the gesture; the durable pose is published once it ends.
    const publish = () => {
      const pose: [ViewState["camera"], ViewState["target"]] = [
        camera.position.clone().add(origin).toArray() as ViewState["camera"],
        controls.target.clone().add(origin).toArray() as ViewState["target"],
      ];
      const s = latest.current.state;
      if (pose[0].every((v, i) => v === s.camera[i]) && pose[1].every((v, i) => v === s.target[i]))
        return;
      published.add(pose[0]).add(pose[1]);
      latest.current.onChange({ camera: pose[0], target: pose[1] });
    };
    controls.addEventListener("change", render);
    controls.addEventListener("end", publish);
    const resize = new ResizeObserver(() => {
      const width = mount.clientWidth,
        height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(mount);
    const ray = new THREE.Raycaster();
    const pointer = (event: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - r.left) / r.width) * 2 - 1,
          1 - ((event.clientY - r.top) / r.height) * 2,
        ),
        camera,
      );
    };
    let down = [0, 0];
    const planPoint = (event: PointerEvent): [number, number] | null => {
      pointer(event);
      const hit = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -drawingZ),
        new THREE.Vector3(),
      );
      return hit ? [hit.x + origin.x, hit.y + origin.y] : null;
    };
    const handleAt = (event: PointerEvent): number | null => {
      const r = renderer.domElement.getBoundingClientRect();
      let best: number | null = null,
        distance = 10;
      latest.current.state.polyline.forEach((p, i) => {
        const screen = new THREE.Vector3(p[0] - origin.x, p[1] - origin.y, drawingZ).project(
          camera,
        );
        const d = Math.hypot(
          ((screen.x + 1) * r.width) / 2 + r.left - event.clientX,
          ((1 - screen.y) * r.height) / 2 + r.top - event.clientY,
        );
        if (screen.z < 1 && d < distance) [best, distance] = [i, d];
      });
      return best;
    };
    // While drawing a bent cut, the first handle snaps the next point onto it to close the polygon.
    const drawPoint = (event: PointerEvent): [number, number] | null => {
      const points = latest.current.state.polyline;
      return latest.current.drawing === "bent" && points.length >= 3 && handleAt(event) === 0
        ? points[0]!
        : planPoint(event);
    };
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
      if (event.button !== 0 || latest.current.drawing) return;
      dragged = handleAt(event);
      if (dragged === null) return;
      draft = [...latest.current.state.polyline];
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.stopImmediatePropagation();
      drawCut();
    };
    const pointerMove = (event: PointerEvent) => {
      if (dragged !== null && draft) {
        const p = planPoint(event);
        if (p) draft[dragged] = p;
        event.stopImmediatePropagation();
        drawCut();
      } else if (latest.current.drawing) {
        hover = drawPoint(event);
        hot = hover === latest.current.state.polyline[0] ? 0 : null;
        drawCut();
      } else if (event.buttons === 0) {
        const next = handleAt(event);
        renderer.domElement.style.cursor = next === null ? "" : "grab";
        if (next !== hot) {
          hot = next;
          drawCut();
        }
      }
    };
    const pointerLeave = () => {
      hover = null;
      drawCut();
    };
    const pointerUp = (event: PointerEvent) => {
      if (dragged !== null) {
        dragged = null;
        controls.enabled = latest.current.drawing === null;
        renderer.domElement.releasePointerCapture(event.pointerId);
        event.stopImmediatePropagation();
        // An accepted draft stays drawn until the state carrying it syncs; a rejected one snaps back.
        if (!latest.current.onChange({ polyline: draft! })) {
          draft = null;
          drawCut();
        }
        return;
      }
      if (event.button !== 0 || Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 5)
        return;
      if (latest.current.drawing) {
        const p = drawPoint(event);
        if (p) latest.current.onDraw(p);
        return;
      }
      pointer(event);
      const hits = ray
        .intersectObjects(meshes.filter((mesh) => mesh.visible))
        .filter(
          (h) =>
            h.object.visible &&
            retained(h.point.clone().add(origin).toArray(), latest.current.state, polygon),
        );
      latest.current.onChange({
        selected: (hits[0]?.object.userData.key as string | undefined) ?? null,
      });
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown, true);
    renderer.domElement.addEventListener("pointermove", pointerMove, true);
    renderer.domElement.addEventListener("pointerup", pointerUp, true);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    sync();
    return () => {
      update.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown, true);
      renderer.domElement.removeEventListener("pointermove", pointerMove, true);
      renderer.domElement.removeEventListener("pointerup", pointerUp, true);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const overlay of [cutLine, offsetLine, handles]) {
        overlay.geometry.dispose();
        overlay.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.metadata, props.positions]);
  useEffect(() => {
    update.current?.();
  }, [props.state, props.drawing]);
  return <div ref={host} className="absolute inset-0 min-h-0 overflow-hidden" />;
}
