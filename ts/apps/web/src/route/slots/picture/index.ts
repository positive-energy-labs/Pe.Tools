import type { Mark, PictureScope, PictureSlot, Vec3 } from "@pe/agent-contracts/slots";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";

/*
 * The kernel seam for the picture slot (ADR 0035 rules 1 and 2). The slot resolves every
 * SubjectRef to geometry itself, placement and sub included: there is no route translator, no
 * element-key regex and no selection-string bridge. Point (Pea's pointer, ADR 0030 rule 10) never
 * writes the selection; select writes it; frame moves the camera to fit; inspect answers a
 * scope's members, and an empty region answers an empty set, never a refusal.
 * Owner: slice 8, which replaces every throw here and the borrowed picture body.
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

export function pictureSlot<C>(slot: PictureSlot<C>, ctx: C, input: PictureInput): PictureHandle {
  void slot;
  void ctx;
  void input;
  throw Error("not implemented: slice 8 (picture slot points, selects, frames and inspects)");
}
