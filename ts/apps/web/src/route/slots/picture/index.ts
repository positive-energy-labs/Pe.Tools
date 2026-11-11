import type { Mark, PictureScope, PictureSlot, Vec3 } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";

/*
 * The kernel seam for the picture slot (ADR 0035 rules 1 and 2). The slot resolves every
 * SubjectRef to geometry itself, placement and sub included: there is no route translator, no
 * element-key regex and no selection-string bridge. Point (Pea's pointer, ADR 0030 rule 10) never
 * writes the selection; select writes it; frame moves the camera to fit; inspect answers a
 * scope's members, and an empty region answers an empty set, never a refusal.
 */

/** A captured subject the kernel can draw: the ref and where its geometry is, in model feet. */
export interface Captured {
  readonly ref: SubjectRefCode;
  readonly point: Vec3;
}

export interface PictureInput {
  /** The route subject's members, for `scope: "subject"`. */
  readonly subject: readonly SubjectRefCode[];
  /** Everything the scene capture resolved, by SubjectRef. Nothing else is drawable. */
  readonly captured: readonly Captured[];
}

export interface PictureState {
  readonly scope: PictureScope;
  readonly pointed: readonly SubjectRefCode[];
  readonly selected: readonly SubjectRefCode[];
  /** Null = fit the scope. A frame sets it to the refs' fit. */
  readonly viewport: { readonly center: Vec3; readonly radius: number } | null;
}

export interface PictureHandle {
  read(): PictureState;
  point(ref: SubjectRefCode): void;
  select(refs: readonly SubjectRefCode[]): void;
  frame(refs: readonly SubjectRefCode[]): void;
  inspect(scope: PictureScope): { readonly members: readonly SubjectRefCode[] };
  /** The declared marks plus one per pointed ref, each resolved to geometry. */
  marks(): readonly Mark[];
}

/** A mark on a SubjectRef sits at its captured point; a ref nothing captured is not drawable (null). */
export function resolveMark(mark: Mark, captured: readonly Captured[]): Mark | null {
  if (typeof mark.at !== "string") return mark;
  const at = captured.find((c) => c.ref === mark.at);
  return at ? { ...mark, at: { point: at.point } } : null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const per = (f: (i: 0 | 1 | 2) => number): Vec3 => [f(0), f(1), f(2)];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Whether a model point lies in a scope; a subjects scope holds its refs, never a region. */
function within(scope: PictureScope, c: Captured): boolean {
  if (scope.kind === "subjects") return scope.refs.includes(c.ref);
  if (scope.kind === "box") return c.point.every((v, i) => v >= scope.min[i]! && v <= scope.max[i]!);
  const local = sub(c.point, scope.frame.origin);
  const [u, v, w] = [dot(local, scope.frame.x), dot(local, scope.frame.y), dot(local, cross(scope.frame.x, scope.frame.y))];
  if (w < scope.depth[0] || w > scope.depth[1]) return false;
  // Even-odd ray cast in the frame's plane.
  let inside = false;
  const ring = scope.polygon;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pictureSlot<C>(slot: PictureSlot<C>, ctx: C, input: PictureInput): PictureHandle {
  const scope: PictureScope = slot.scope === "subject" ? { kind: "subjects", refs: input.subject } : slot.scope.derive(ctx);
  let state: PictureState = { scope, pointed: [], selected: [], viewport: null };
  const pointsOf = (refs: readonly SubjectRefCode[]) => input.captured.filter((c) => refs.includes(c.ref)).map((c) => c.point);
  return {
    read: () => state,
    point: (ref) => void (state = { ...state, pointed: [ref] }),
    select: (refs) => void (state = { ...state, selected: [...refs] }),
    frame: (refs) => {
      const points = pointsOf(refs);
      if (!points.length) return;
      const min = per((i) => Math.min(...points.map((p) => p[i])));
      const max = per((i) => Math.max(...points.map((p) => p[i])));
      const center = per((i) => (min[i] + max[i]) / 2);
      // A single point still frames: a foot of radius, never zero.
      state = { ...state, viewport: { center, radius: Math.max(1, Math.hypot(...sub(max, min)) / 2) } };
    },
    inspect: (region) => ({ members: input.captured.filter((c) => within(region, c)).map((c) => c.ref) }),
    marks: () =>
      [...(slot.marks?.(ctx) ?? []), ...state.pointed.map((ref): Mark => ({ kind: "ring", at: ref }))]
        .flatMap((mark) => resolveMark(mark, input.captured) ?? []),
  };
}
