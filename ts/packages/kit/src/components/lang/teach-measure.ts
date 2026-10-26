import { subscribeTeaching } from "./teach";

type Source = { nodes: readonly HTMLElement[]; measure: () => void };
const sources = new Set<Source>();
const dirty = new Set<Source>();
const boxes = new Map<HTMLElement, DOMRect>();
let consumers = 0;
let frame = 0;
let mutation: MutationObserver | undefined;
let resize: ResizeObserver | undefined;
/** Read picture breadcrumbs as distinct words, as their visible chevrons separate them. */
export function teachingTitle(pane: HTMLElement) {
  const title = pane.querySelector('[data-slot="pane-title"]');
  const segments = [...(title?.querySelectorAll("[data-crumb-segment]") ?? [])];
  return (
    (segments.length
      ? segments
          .map((segment) => segment.textContent?.trim())
          .filter(Boolean)
          .join(" › ")
      : title?.textContent?.trim()) ||
    pane.querySelector("[data-list-view][aria-label]")?.getAttribute("aria-label") ||
    undefined
  );
}
/** Every affected region/anchor is read once in the shared frame, even with many facts. */
export const teachingBox = (node: HTMLElement) => {
  if (!boxes.has(node)) boxes.set(node, node.getBoundingClientRect());
  return boxes.get(node)!;
};
function schedule() {
  if (!consumers || frame || !dirty.size) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const pending = [...dirty];
    dirty.clear();
    pending.forEach((source) => source.measure());
    boxes.clear();
  });
}
function invalidate(target: Node, ancestors = true) {
  for (const source of sources)
    if (
      source.nodes.some(
        (node) =>
          (ancestors && target.contains(node)) ||
          (node !== document.body && node !== document.documentElement && node.contains(target)),
      )
    )
      dirty.add(source);
}
export function registerTeachingMeasure(source: Source) {
  sources.add(source);
  dirty.add(source);
  source.nodes.forEach((node) => resize?.observe(node));
  schedule();
  return () => {
    sources.delete(source);
    dirty.delete(source);
    source.nodes.forEach((node) => {
      if (![...sources].some((other) => other.nodes.includes(node))) resize?.unobserve(node);
    });
  };
}
/** Raw fact subscribers (such as picture legends) do not acquire this document observer. */
export function subscribeMeasuredTeaching(notify: () => void) {
  const unsubscribe = subscribeTeaching(notify);
  if (consumers++ === 0) {
    mutation = new MutationObserver((records) => {
      records.forEach((record) => {
        invalidate(record.target, record.type === "attributes");
        if (record.type === "childList")
          [...record.addedNodes, ...record.removedNodes].forEach((node) => invalidate(node));
      });
      schedule();
    });
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "hidden", "class", "data-pane-folded", "data-pane-stacked"],
    });
    resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            entries.forEach((entry) => invalidate(entry.target));
            schedule();
          });
    sources.forEach((source) => {
      dirty.add(source);
      source.nodes.forEach((node) => resize?.observe(node));
    });
    schedule();
  }
  return () => {
    unsubscribe();
    if (--consumers) return;
    mutation?.disconnect();
    resize?.disconnect();
    mutation = undefined;
    resize = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    dirty.clear();
    boxes.clear();
  };
}
