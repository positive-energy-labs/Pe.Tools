import { z } from "zod";

/**
 * Page keys a route's fields carry, each a zod schema with a default (ledger
 * `docs/features/design-system/LEDGER.md`: viewport, mode, layers and subject). The value is typed;
 * a key that is not a plain string brings the codec that writes it as one string, the form a link
 * and Pea's lease carry (`route-address.ts` `field`).
 */

/** A codec's answer for text it cannot read: never a value, so `null` stays a legitimate value. */
export const INVALID: unique symbol = Symbol("invalid");

/** A value as one string: the link and lease form. */
export interface Codec<T> {
  encode(value: T): string;
  decode(text: string): T | typeof INVALID;
}

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
export const planeViewportSchema = z.object({
  kind: z.literal("plane"),
  scale: finite,
  tx: finite,
  ty: finite,
});
export const orbitViewportSchema = z.object({
  kind: z.literal("orbit"),
  yaw: finite,
  elev: finite,
  zoom: finite,
  pivot: z.tuple([finite, finite, finite]),
});
export const viewportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scroll"), top: finite, left: finite }),
  planeViewportSchema,
  orbitViewportSchema,
]);

/**
 * A viewport key: one kind (or any), or null = fit, the default. A fit has no pose of its own; the
 * drawing computes it from what it shows, so nothing here invents a pivot or a scale for it.
 */
export const viewportKey = <V extends z.ZodType<Viewport>>(kind: V) =>
  kind.nullable().default(null);

/** `""` is fit (null); malformed text is `INVALID`; a wrong kind is refused by the key's schema. */
export const fitViewportCodec = <V extends Viewport>(): Codec<V | null> => ({
  encode: (value) => (value ? viewportCodec.encode(value) : ""),
  decode: (text) => (text === "" ? null : ((viewportCodec.decode(text) as V | null) ?? INVALID)),
});

/**
 * The directions a person names for an orbit picture, in the scene's frame (`scene/orbit.ts`):
 * yaw 0 = seen from east (+X), 90 = from north (+Y); elev 90 = plan. A look keeps a pose's pivot
 * and zoom, so it turns the effective pose the drawing shows, never a fit. Plan and iso tilt only,
 * keeping the shown yaw; a cardinal names its yaw.
 */
const ISO_ELEV = Number(((Math.atan(Math.SQRT1_2) * 180) / Math.PI).toFixed(3));
export const orbitLooks = {
  plan: { elev: 90 },
  iso: { elev: ISO_ELEV },
  north: { yaw: 90, elev: 0 },
  south: { yaw: -90, elev: 0 },
  east: { yaw: 0, elev: 0 },
  west: { yaw: 180, elev: 0 },
} as const satisfies Record<
  string,
  Pick<OrbitViewport, "elev"> & Partial<Pick<OrbitViewport, "yaw">>
>;
export type OrbitLook = keyof typeof orbitLooks;

export const modeKey = <const M extends readonly [string, ...string[]]>(
  modes: M,
  initial: M[number],
) => z.enum(modes).default(initial as never);

/**
 * The layers on, as names of `layers`; the default is the `on` set a picture opens with, so the
 * address stays bare until a person flips one, and an empty list is none on. An unknown name makes
 * the whole value unreadable (the default).
 */
export const layersKey = <const L extends readonly [string, ...string[]]>(
  layers: L,
  on: readonly L[number][],
) => z.array(z.enum(layers)).default(layers.filter((layer) => on.includes(layer)) as never);

/** `on` with one layer flipped, in `layers` order. */
export const toggleLayer = <L extends readonly string[]>(
  layers: L,
  on: readonly L[number][],
  layer: L[number],
): L[number][] => layers.filter((item) => (item === layer) !== on.includes(item));

/** The page's subject: an id or a name the route resolves; empty = none. */
export const subjectKey = () => z.string().default("");
