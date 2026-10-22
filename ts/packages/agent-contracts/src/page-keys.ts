import { z } from "zod";

/**
 * Page keys a route's fields carry, each a zod schema with a default (ledger
 * `docs/features/design-system/LEDGER.md`: viewport, mode, layers and subject). The value is typed;
 * a key that is not a plain string brings the codec that writes it as one string, the form a link
 * and Pea's lease carry (`route-address.ts` `field`).
 */

/** Viewport: one of three kinds. `viewportCodec` writes the link and lease form. */
export type ScrollViewport = { kind: "scroll"; top: number; left: number };
export type PlaneViewport = { kind: "plane"; scale: number; tx: number; ty: number };
export type OrbitViewport = {
  kind: "orbit";
  yaw: number;
  elev: number;
  zoom: number;
  pivot: [number, number, number];
};
export type Viewport = ScrollViewport | PlaneViewport | OrbitViewport;

/** Three decimals: enough for feet and scale, short enough to read in an address. */
const num = (n: number) => String(Number(n.toFixed(3)) || 0);
const NUMBER = /^-?\d+(\.\d+)?$/;
const nums = (text: string, count: number): number[] | null => {
  const parts = text.split(",");
  return parts.length === count && parts.every((part) => NUMBER.test(part))
    ? parts.map(Number)
    : null;
};

/** `scroll:1200,0`, `plane:0.8,-120,33`, `orbit:45,30,1.25@120.5,-40,12` (yaw,elev,zoom@pivot). */
export const viewportCodec = {
  encode(v: Viewport): string {
    if (v.kind === "scroll") return `scroll:${[v.top, v.left].map(num).join(",")}`;
    if (v.kind === "plane") return `plane:${[v.scale, v.tx, v.ty].map(num).join(",")}`;
    return `orbit:${[v.yaw, v.elev, v.zoom].map(num).join(",")}@${v.pivot.map(num).join(",")}`;
  },
  /** Null on any malformed input, so the url reader falls to the key's default. */
  decode(s: string): Viewport | null {
    const colon = s.indexOf(":");
    if (colon < 0) return null;
    const kind = s.slice(0, colon);
    const body = s.slice(colon + 1);
    if (kind === "scroll") {
      const n = nums(body, 2);
      return n ? { kind, top: n[0]!, left: n[1]! } : null;
    }
    if (kind === "plane") {
      const n = nums(body, 3);
      return n ? { kind, scale: n[0]!, tx: n[1]!, ty: n[2]! } : null;
    }
    if (kind === "orbit") {
      const [camera = "", pivot = "", ...rest] = body.split("@");
      const c = nums(camera, 3);
      const p = nums(pivot, 3);
      return c && p && !rest.length
        ? { kind, yaw: c[0]!, elev: c[1]!, zoom: c[2]!, pivot: [p[0]!, p[1]!, p[2]!] }
        : null;
    }
    return null;
  },
};

const finite = z.number().finite();
export const viewportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scroll"), top: finite, left: finite }),
  z.object({ kind: z.literal("plane"), scale: finite, tx: finite, ty: finite }),
  z.object({
    kind: z.literal("orbit"),
    yaw: finite,
    elev: finite,
    zoom: finite,
    pivot: z.tuple([finite, finite, finite]),
  }),
]);

/** The Page holds a `Viewport`; its field writes it through `viewportCodec`. */
export const viewportKey = (initial: Viewport) => viewportSchema.default(initial);

export const modeKey = <const M extends readonly [string, ...string[]]>(
  modes: M,
  initial: M[number],
) => z.enum(modes).default(initial as never);

/** Comma-joined layer names, in `layers` order; empty = none on. */
export const layersKey = <const L extends readonly string[]>(layers: L, on: readonly L[number][]) =>
  z.string().default(layers.filter((layer) => on.includes(layer)).join(","));

/** The known names `value` holds, in `layers` order; unknown names drop. */
export const layersOf = <L extends readonly string[]>(layers: L, value: string): L[number][] => {
  const named = value.split(",").map((name) => name.trim());
  return layers.filter((layer) => named.includes(layer));
};

/** `value` with one layer flipped, as the address writes it. */
export const toggleLayer = <L extends readonly string[]>(
  layers: L,
  value: string,
  layer: L[number],
): string => {
  const on = layersOf(layers, value);
  return layers.filter((item) => (item === layer) !== on.includes(item)).join(",");
};

/** The page's subject: an id or a name the route resolves; empty = none. */
export const subjectKey = () => z.string().default("");
