/**
 * Kit tokens as three colours, so the 3D picture is drawn in the page's own palette. Resolved
 * through the browser (light-dark, OKLCH, color-mix) to sRGB at the moment of the call.
 */
import * as THREE from "three";
import { tokenRef } from "@pe/kit/lib/token";

export function inkOf(role: string, within: Element = document.documentElement): THREE.Color {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  probe.style.color = tokenRef(role);
  within.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const ctx = probe.getContext("2d")!;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
}
