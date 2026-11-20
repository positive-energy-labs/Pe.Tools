import { sceneSectionSchema, type SceneSection } from "@pe/agent-contracts";
import { axisBounds, CUT_AXES, cutPolygon, type Cut } from "@pe/web-kernel/scene/cuts";
import type { Bounds } from "@pe/web-kernel/scene/types";

type Source = { document: string | null; section: SceneSection | null };
type Draft = { section: SceneSection; refusal: string | null };

// A ten-thousandth of a host foot keeps rounding well below a screen pixel.
const roundCut = (cut: Cut): Cut => ({
  ...cut,
  polyline: cut.polyline.map(([u, v]) => [Number(u.toFixed(4)), Number(v.toFixed(4))]),
});

/** Interaction lifetime only. Canonical Page and document are checked again at release. */
export class SectionEditorController {
  private draft: Draft | null = null;
  private basis: string | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private source: () => Source,
    private bounds: () => Bounds | null,
    private commit: (section: SceneSection | null, intent: "named") => void,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  read = () => this.draft;
  private emit() {
    this.listeners.forEach((f) => f());
  }
  begin(section: SceneSection) {
    this.basis = JSON.stringify(this.source());
    this.preview(section);
  }
  preview(section: SceneSection) {
    this.reconcile();
    if (this.basis === null) return;
    this.draft = { section, refusal: this.refusal(section) };
    this.emit();
  }
  private refusal(section: SceneSection): string | null {
    try {
      const parsed = sceneSectionSchema.safeParse(section);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid cut");
      if (section.kind === "cuts") {
        const bounds = this.bounds();
        if (!bounds) throw new Error("No scene to section");
        CUT_AXES.forEach((axis) => cutPolygon(section.cuts[axis], axisBounds(bounds, axis)));
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid cut";
    }
  }
  reconcile() {
    if (this.basis !== null && this.basis !== JSON.stringify(this.source())) this.cancel();
  }
  release() {
    this.reconcile();
    const draft = this.draft,
      basis = this.basis;
    this.cancel();
    if (!draft || draft.refusal || basis === null) return draft?.refusal ?? null;
    let section =
      draft.section.kind === "cuts" &&
      Object.values(draft.section.cuts).every((cut) => cut.polyline.length === 0)
        ? null
        : draft.section;
    const current = JSON.stringify(this.source().section);
    if (JSON.stringify(section) === current) return null;
    if (section?.kind === "cuts") {
      const { top, north, east } = section.cuts;
      section = {
        kind: "cuts",
        cuts: { top: roundCut(top), north: roundCut(north), east: roundCut(east) },
      };
      const refusal = this.refusal(section);
      if (refusal) return refusal;
    }
    if (JSON.stringify(section) !== current) this.commit(section, "named");
    return null;
  }
  cancel = () => {
    this.basis = null;
    if (this.draft) {
      this.draft = null;
      this.emit();
    }
  };
}
