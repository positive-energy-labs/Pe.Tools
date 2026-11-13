import { sceneSectionSchema, type SceneSection } from "@pe/agent-contracts";
import { axisBounds, CUT_AXES, cutPolygon } from "./cuts";
import type { Bounds } from "./types";

type Source = { document: string | null; section: SceneSection | null };
type Draft = { section: SceneSection; refusal: string | null };
/** Interaction lifetime only. Canonical Page and document are checked again at release. */
export class SectionEditorController {
  private draft: Draft | null = null;
  private basis: string | null = null;
  private listeners = new Set<() => void>();
  constructor(
    private source: () => Source,
    private bounds: () => Bounds | null,
    private commit: (section: SceneSection, intent: "named") => void,
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
    try {
      sceneSectionSchema.parse(section);
      if (section.kind === "cuts") {
        const bounds = this.bounds();
        if (!bounds) throw new Error("No scene to section");
        CUT_AXES.forEach((axis) => cutPolygon(section.cuts[axis], axisBounds(bounds, axis)));
      }
      this.draft = { section, refusal: null };
    } catch (error) {
      this.draft = { section, refusal: error instanceof Error ? error.message : "Invalid cut" };
    }
    this.emit();
  }
  reconcile() {
    if (this.basis !== null && this.basis !== JSON.stringify(this.source())) this.cancel();
  }
  release() {
    this.reconcile();
    const draft = this.draft,
      basis = this.basis;
    this.cancel();
    if (
      draft &&
      !draft.refusal &&
      basis !== null &&
      JSON.stringify(draft.section) !== JSON.stringify(this.source().section)
    )
      this.commit(draft.section, "named");
  }
  cancel = () => {
    this.basis = null;
    if (this.draft) {
      this.draft = null;
      this.emit();
    }
  };
}
