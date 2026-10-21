import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cutPolygon, elementKey, retained, type Metadata, type ViewState } from "./state";

type Props = {
  metadata: Metadata;
  positions: Float32Array;
  state: ViewState;
  drawing: "straight" | "bent" | null;
  onChange: (change: Partial<ViewState>) => void;
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
      "Space 3D mesh. Left drag orbit, right drag pan, wheel zoom. Click an element to select.",
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
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false });
    const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
    line.renderOrder = 10;
    scene.add(line);
    let syncing = false;
    let dragged: number | null = null;
    let polygon: [number, number][] = [];
    const drawingZ = props.metadata.bounds.maxZ - origin.z + 0.1;
    const render = () => renderer.render(scene, camera);
    const sync = () => {
      syncing = true;
      const s = latest.current.state;
      camera.position.fromArray(s.camera).sub(origin);
      controls.target.fromArray(s.target).sub(origin);
      controls.update();
      const hidden = new Set(s.hidden),
        isolated = s.isolated && new Set(s.isolated);
      for (const mesh of meshes) {
        const key = mesh.userData.key as string;
        mesh.visible = !hidden.has(key) && (!isolated || isolated.has(key));
        mesh.material.emissive.setHex(s.selected === key ? 0x666666 : 0x000000);
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
      polygon = cutPolygon(s.polyline, props.metadata.bounds);
      uniforms.spacePolygonCount.value = polygon.length;
      uniforms.spaceKeepInside.value = s.keepInside;
      polygon.forEach((v, i) =>
        uniforms.spacePolygon.value[i]!.set(v[0] - origin.x, v[1] - origin.y),
      );
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(
        s.polyline.map((p) => new THREE.Vector3(p[0] - origin.x, p[1] - origin.y, drawingZ)),
      );
      line.visible = s.polyline.length > 1;
      controls.enabled = latest.current.drawing === null && dragged === null;
      syncing = false;
      render();
    };
    update.current = sync;
    const changed = () => {
      render();
      if (!syncing)
        latest.current.onChange({
          camera: camera.position.clone().add(origin).toArray() as ViewState["camera"],
          target: controls.target.clone().add(origin).toArray() as ViewState["target"],
        });
    };
    controls.addEventListener("change", changed);
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
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
      if (
        event.button !== 0 ||
        latest.current.drawing ||
        Math.abs(camera.position.clone().sub(controls.target).normalize().z) < 0.99
      )
        return;
      const r = renderer.domElement.getBoundingClientRect();
      latest.current.state.polyline.forEach((p, i) => {
        const screen = new THREE.Vector3(p[0] - origin.x, p[1] - origin.y, drawingZ).project(
          camera,
        );
        if (
          Math.hypot(
            ((screen.x + 1) * r.width) / 2 + r.left - event.clientX,
            ((1 - screen.y) * r.height) / 2 + r.top - event.clientY,
          ) < 14
        )
          dragged = i;
      });
      if (dragged !== null) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        event.stopImmediatePropagation();
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (dragged === null) return;
      const p = planPoint(event);
      if (p)
        latest.current.onChange({
          polyline: latest.current.state.polyline.map((v, i) => (i === dragged ? p : v)),
        });
      event.stopImmediatePropagation();
    };
    const pointerUp = (event: PointerEvent) => {
      if (dragged !== null) {
        dragged = null;
        controls.enabled = latest.current.drawing === null;
        renderer.domElement.releasePointerCapture(event.pointerId);
        event.stopImmediatePropagation();
        return;
      }
      if (event.button !== 0 || Math.hypot(event.clientX - down[0]!, event.clientY - down[1]!) > 5)
        return;
      if (latest.current.drawing) {
        const p = planPoint(event);
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
    sync();
    return () => {
      update.current = null;
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown, true);
      renderer.domElement.removeEventListener("pointermove", pointerMove, true);
      renderer.domElement.removeEventListener("pointerup", pointerUp, true);
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      line.geometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.metadata, props.positions]);
  useEffect(() => {
    update.current?.();
  }, [props.state, props.drawing]);
  return <div ref={host} className="absolute inset-0 min-h-0 overflow-hidden" />;
}
