/**
 * Kit tokens as three colours, so the 3D picture is drawn in the page's own palette. Resolved
 * through the browser (light-dark, OKLCH, color-mix) to sRGB at the moment of the call.
 */
import * as THREE from "three";
import { tokenRef } from "@pe/kit/lib/token";

let sampler: CanvasRenderingContext2D | null = null;
const colours = new Map<string, THREE.Color>();

export function inkOf(role: string, within: Element = document.documentElement): THREE.Color {
  const probe = document.createElement("span");
  probe.style.color = tokenRef(role);
  within.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const held = colours.get(css);
  if (held) return held.clone();
  if (!sampler) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    sampler = canvas.getContext("2d", { willReadFrequently: true })!;
  }
  const ctx = sampler;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const colour = new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
  if (colours.size >= 128) colours.delete(colours.keys().next().value!);
  colours.set(css, colour);
  return colour.clone();
}
