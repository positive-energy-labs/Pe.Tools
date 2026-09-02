/**
 * PROTO-TUTORIAL: the layout is the data. The tutorial measures the rendered panes instead of
 * redrawing the workspace, then joins each pane to the current route product by structural ID.
 */
import type { Pane as ModelPane } from "#/targeting/model";
import { readCurrentManifest } from "./manifest-ref";

export type PaneKindWord = "navigation" | "visual" | "content" | "inspector";

export interface MeasuredPane {
  index: number;
  id: string | null;
  kind: PaneKindWord;
  title: string;
  label: string;
  rect: DOMRect;
  el: HTMLElement;
  model: ModelPane<string> | null;
  says: string;
  draws: readonly string[];
  hasShortcuts: boolean;
}

export interface MeasuredLayout {
  panes: MeasuredPane[];
  frame: DOMRect;
}

const KIND_SAYS: Record<PaneKindWord, string> = {
  navigation: "where you choose what the route works on",
  visual: "the drawing — evidence you can see, not just counts",
  content: "the working table; most editing happens here",
  inspector: "detail for the one thing selected",
};

export function measureLayout(): MeasuredLayout | null {
  const els = [...document.querySelectorAll<HTMLElement>('[data-slot="pane"]')];
  if (els.length === 0) return null;
  const manifest = readCurrentManifest();
  const panes = els.map((el, index) => {
    const id = el.dataset.paneId || null;
    const kind = (el.dataset.kind ?? "content") as PaneKindWord;
    const title = el.querySelector('[data-slot="pane-header"] h2')?.textContent?.trim() ?? "";
    const modelPane =
      (id
        ? manifest?.product.panes.find((pane) => pane.key === id)
        : manifest?.product.panes.find(
            (pane) => title !== "" && pane.label.toLowerCase() === title.toLowerCase(),
          )) ?? null;
    const draws = modelPane?.draws ?? [];
    const says =
      manifest && modelPane
        ? `draws ${draws.map((key) => manifest.product.slots[key]?.placeholder ?? key).join(" and ")}`
        : KIND_SAYS[kind];
    return {
      index,
      id,
      kind,
      title,
      label: title || modelPane?.label || kind,
      rect: el.getBoundingClientRect(),
      el,
      model: modelPane,
      says,
      draws,
      hasShortcuts: el.dataset.hasShortcuts === "true",
    };
  });
  const workspace = document.querySelector<HTMLElement>('[data-slot="pane-workspace"]');
  const frame = workspace?.getBoundingClientRect() ?? unionRect(panes.map((pane) => pane.rect));
  return { panes, frame };
}

function unionRect(rects: DOMRect[]): DOMRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export interface ProtoPaneShortcut {
  hotkey: string;
  label: string;
  wired: boolean;
  needs?: string;
}

export function paneShortcuts(pane: MeasuredPane): ProtoPaneShortcut[] {
  const focus: ProtoPaneShortcut = {
    hotkey: `Alt+${pane.index + 1}`,
    label: `focus ${pane.label}`,
    wired: pane.hasShortcuts,
    needs: pane.hasShortcuts ? undefined : "pane-owned shortcuts",
  };
  const scope: ProtoPaneShortcut = { hotkey: "Esc", label: "clear room scope", wired: true };
  const review: ProtoPaneShortcut[] = [
    { hotkey: "j / k", label: "cursor down / up", wired: true },
    { hotkey: "a / d", label: "accept / decline room", wired: true },
    scope,
  ];
  if (pane.title === "zones" || pane.kind === "navigation") return [focus, scope];
  if (pane.kind === "visual") return [focus, scope];
  if (pane.kind === "content") return [focus, ...review];
  return [focus];
}
