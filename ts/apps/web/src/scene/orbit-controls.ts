import type { Camera } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** OrbitControls 0.186 recomputes getRootNode at disposal, after React may detach its canvas. */
export function createOrbitControls(camera: Camera, canvas: HTMLElement) {
  const root = canvas.getRootNode();
  const controls = new OrbitControls(camera, canvas);
  const intercept = controls as unknown as {
    _interceptControlDown: EventListener;
    _interceptControlUp: EventListener;
  };
  const disconnect = controls.disconnect.bind(controls);
  controls.disconnect = () => {
    disconnect();
    root.removeEventListener("keydown", intercept._interceptControlDown, true);
    root.removeEventListener("keyup", intercept._interceptControlUp, true);
  };
  return controls;
}
