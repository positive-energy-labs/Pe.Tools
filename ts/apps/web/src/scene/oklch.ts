/** OKLCH over three's linear-sRGB working colours (Ottosson matrices), so lightness is perceptual. */
import * as THREE from "three";

const cbrt = Math.cbrt;
export function toOklch({ r, g, b }: THREE.Color) {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}
const linear = (L: number, C: number, h: number) => {
  const a = C * Math.cos(h),
    b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const;
};
const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The same hue at lightness `L`; chroma shrinks only as far as the sRGB gamut requires. */
export function withLightness(colour: THREE.Color, L: number) {
  const { C, h } = toOklch(colour);
  L = Math.min(0.97, Math.max(0.03, L));
  let lo = 0,
    hi = C;
  if (inGamut(linear(L, C, h))) lo = C;
  else for (let i = 0; i < 20; i++) inGamut(linear(L, (lo + hi) / 2, h)) ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2);
  const [r, g, b] = linear(L, lo, h);
  return colour.clone().setRGB(Math.max(0, r), Math.max(0, g), Math.max(0, b), THREE.LinearSRGBColorSpace);
}
export const liftLightness = (colour: THREE.Color, dL: number) =>
  withLightness(colour, toOklch(colour).L + dL);
